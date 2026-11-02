import { config } from '@/config';

// Mock switches: honoured only on staging; production and tests always go live (tests mock at the HTTP boundary).
export const systemSettings = {
  useMock(key: string): boolean {
    return config.appEnv === 'staging' && config.mockSettings.includes(key);
  },
};
