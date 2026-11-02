import axios, { AxiosInstance, Method } from 'axios';
import { DataSource } from 'typeorm';
import { config } from '@/config';
import { ThirdPartyLogEntity } from '@/common/logging/log.entities';

export interface PartnerCall { event: string; method: Method; url: string; data?: unknown; redact?: string[] }
export interface PartnerResult<T> { status: number; body: T }

const redactKeys = (v: unknown, keys: string[]): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, keys.includes(k) ? '[REDACTED]' : x]))
    : v;

// Shared outbound client: every partner call is timed and written to third_party_logs, success or failure.
export class ThirdPartyClient {
  constructor(private readonly provider: string, private readonly http: AxiosInstance, private readonly ds: () => DataSource | null) {}

  async call<T>(c: PartnerCall): Promise<PartnerResult<T>> {
    const started = Date.now();
    let statusCode: number | null = null; let body: unknown = null; let message: string | null = null;
    try {
      const res = await this.http.request<T>({ method: c.method, url: c.url, data: c.data, validateStatus: () => true });
      statusCode = res.status; body = res.data;
      return { status: res.status, body: res.data };
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      await this.ds()?.manager.insert(ThirdPartyLogEntity, {
        provider: this.provider, event: c.event, method: String(c.method).toUpperCase(), url: c.url, statusCode,
        durationMs: Date.now() - started, requestBody: redactKeys(c.data ?? null, c.redact ?? []) as object,
        responseBody: body as object, responseMessage: message,
      }).catch(() => undefined);
    }
  }
}

let dataSource: DataSource | null = null;
const registry = new Map<string, ThirdPartyClient>();
const factories: Record<string, () => AxiosInstance> = {
  paystack: () => axios.create({
    baseURL: config.paystack.baseUrl, timeout: config.partnerTimeoutMs,
    headers: { Authorization: `Bearer ${config.paystack.secretKey}`, 'Content-Type': 'application/json' },
  }),
};

export const connections = {
  init(ds: DataSource) { dataSource = ds; },
  get(provider: keyof typeof factories): ThirdPartyClient {
    const existing = registry.get(provider);
    if (existing) return existing;
    const client = new ThirdPartyClient(provider, factories[provider](), () => dataSource);
    registry.set(provider, client);
    return client;
  },
};
