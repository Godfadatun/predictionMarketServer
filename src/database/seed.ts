import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { AuthUser } from '@/common/decorators';
import { MarketsService } from '@/markets/services/markets.service';
import { MARKET_CATEGORY, NIGERIAN_STATES } from '@/markets/constants/markets.constants';
import { CreateMarketInput } from '@/markets/interfaces/markets.interface';

// Launch catalogue. b is sized so a ₦1–5k trade visibly moves a thin market; house worst-case loss = b·ln(n)·₦100 per market.
// Candidate list = INEC final list (Sept 2026) headline names; VERIFY every market before opening real-money trading.
const PRESIDENTIAL_DAY_CLOSE = new Date('2027-01-15T22:00:00Z'); // 23:00 WAT, eve of the 16 Jan 2027 poll
const GOVERNORSHIP_CLOSE = new Date('2027-02-05T22:00:00Z'); // eve of the 6 Feb 2027 governorship polls
const CANDIDATES = [
  'Bola Tinubu (APC)', 'Atiku Abubakar (ADC)', 'Peter Obi (NDC)', 'Seyi Makinde (APM)', 'Donald Duke (PRP)',
  'Adewole Adebayo (SDP)', 'Omoyele Sowore (AAC)', 'Sandy Onor (PDP)', 'Other candidate',
];
const PARTIES = ['APC', 'ADC', 'PDP', 'NDC', 'APM', 'LP', 'Accord', 'Other party'];
const GOVERNORSHIP_STATES = ['Lagos', 'Kano', 'Rivers', 'Oyo', 'Kaduna', 'Enugu', 'Delta', 'Akwa Ibom'];
// Named-candidate markets where INEC's final list (10 Oct 2026, updated 31 Oct) was reported consistently. Names in INEC's
// surname-first order. Kano/Kaduna/Delta/Akwa Ibom stay party markets (blank NDC slot, Accord vs Action Alliance confusion).
// VERIFY against the INEC PDFs (inecnigeria.org/documents/FINAL LIST - <STATE> STATE GOVERNORSHIP.pdf) before opening trading.
const GOVERNORSHIP_CANDIDATES: Record<string, string[]> = {
  Lagos: [
    'Hamzat Kadri Obafemi (APC)', 'Rhodes-Vivour Gbadebo (ADC)', 'Doherty Adedeji Olugbemiga (PDP)', 'Doherty Olufunso Adeshina (NDC)',
    'Odunaike Oluwapemilerin Olurotimi (LP)', 'Adeoye Adelaja Azeez (APM)', 'Otitoloju Sowore (Accord)', 'Onifade Ademoyegun Taiwo (NNPP)',
  ],
  Rivers: [
    'Chinda Kingsley Ogundu (APC)', 'Ejekwu Samuel Soni (PDP)', 'Pidomson Gabriel Baritulem (ADC)', 'Lulu-Briggs Dumo Owukori (NDC)',
    'Boms Chima Ernest (LP)', 'Whyte Churchill Dagogo (APM)', 'Chibuzor Israel Rain (Accord)', 'Pepple Wari Dienye (NNPP)',
  ],
  Oyo: [
    'Alli Sharafadeen Abiodun (APC)', 'Gbolarumi Hazeem (PDP)', 'Adegoke Taofeek Adegboyega (ADC)', 'Yusuf Akim Adebola (NDC)',
    'Kareem Sola Thompson (LP)', 'Adekanmbi Abimbola (APM)', 'Hamzat Abdulrahman Oriyomi (Accord)',
  ],
  Enugu: [
    'Mbah Peter Ndubuisi (APC)', 'Nnaji Uchechukwu Geoffrey (PDP)', 'Ocho Obodoeze Chukwuma (ADC)', 'Ohaa Chinyeaka Christian (NDC)',
    'Ugwu Okwudilichukwu Chukwudera (LP)', 'Alor Edwin Ikechukwu (Accord)', 'Nnaji Jehu (NNPP)',
  ],
};
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const INEC = 'INEC official declaration (Form EC8D state collation / EC8E national declaration), cross-checked on IReV';

const catalogue = (): CreateMarketInput[] => [
  {
    slug: 'presidential-2027-winner', title: "Who will win Nigeria's 2027 presidential election?", category: MARKET_CATEGORY.PRESIDENTIAL,
    description: 'The candidate INEC declares President-elect after the 16 January 2027 election.', closesAt: PRESIDENTIAL_DAY_CLOSE,
    resolutionSource: INEC, liquidityB: 1500, outcomes: CANDIDATES,
    resolutionRules: 'Resolves to the candidate INEC returns as winner. If a runoff is required, resolves on the runoff declaration. Later tribunal or court decisions do NOT change the result. If the election is postponed by more than 30 days the market is voided and stakes are refunded.',
  },
  ...NIGERIAN_STATES.map((state) => ({
    slug: `presidential-2027-${slugify(state)}`, title: `Who will win ${state} in the 2027 presidential election?`, category: MARKET_CATEGORY.PRESIDENTIAL, state,
    description: `The presidential candidate with the most valid votes in ${state === 'FCT' ? 'the FCT' : `${state} State`} on 16 January 2027.`,
    closesAt: PRESIDENTIAL_DAY_CLOSE, resolutionSource: INEC, liquidityB: 250, outcomes: CANDIDATES,
    resolutionRules: 'Resolves to the candidate with the highest valid votes on the INEC state collation result (Form EC8D). Later tribunal or court decisions do NOT change the result. Postponement over 30 days voids the market.',
  })),
  {
    slug: 'presidential-2027-runoff', title: 'Will the 2027 presidential election go to a runoff?', category: MARKET_CATEGORY.PRESIDENTIAL,
    description: 'Whether INEC orders a second-round (runoff) presidential election because no candidate met the constitutional threshold.',
    closesAt: PRESIDENTIAL_DAY_CLOSE, resolutionSource: INEC, liquidityB: 500, outcomes: ['Yes', 'No'],
    resolutionRules: 'Resolves YES if INEC announces a runoff/second ballot for the 2027 presidential election; NO if INEC declares a winner after the first ballot.',
  },
  {
    slug: 'presidential-2027-turnout-30', title: 'Will national turnout in the 2027 presidential election exceed 30%?', category: MARKET_CATEGORY.PRESIDENTIAL,
    description: 'Total votes cast divided by registered voters, as published by INEC (2023 was about 27%).',
    closesAt: PRESIDENTIAL_DAY_CLOSE, resolutionSource: INEC, liquidityB: 500, outcomes: ['Yes', 'No'],
    resolutionRules: 'Resolves YES if total votes cast / total registered voters on INEC’s final national summary is strictly greater than 30.00%.',
  },
  ...GOVERNORSHIP_STATES.map((state) => (GOVERNORSHIP_CANDIDATES[state] ? {
    slug: `governorship-2027-${slugify(state)}`, title: `Who will win the 2027 ${state} governorship election?`, category: MARKET_CATEGORY.GOVERNORSHIP, state,
    description: `The candidate INEC returns as Governor-elect of ${state} State after the 6 February 2027 election.`,
    closesAt: GOVERNORSHIP_CLOSE, resolutionSource: 'INEC returning officer declaration for the state, cross-checked on IReV', liquidityB: 400,
    outcomes: [...GOVERNORSHIP_CANDIDATES[state], 'Other candidate'],
    resolutionRules: 'Resolves to the candidate INEC declares winner (including after a supplementary election). If a listed candidate is substituted before the poll, the substitute counts as "Other candidate". Tribunal/court decisions do NOT change the result. Postponement over 30 days voids the market.',
  } : {
    slug: `governorship-2027-${slugify(state)}`, title: `Which party will win the 2027 ${state} governorship election?`, category: MARKET_CATEGORY.GOVERNORSHIP, state,
    description: `The party of the candidate INEC returns as Governor-elect of ${state} State after the 6 February 2027 election.`,
    closesAt: GOVERNORSHIP_CLOSE, resolutionSource: 'INEC returning officer declaration for the state, cross-checked on IReV', liquidityB: 400, outcomes: PARTIES,
    resolutionRules: 'Resolves to the party of the candidate INEC declares winner (including after a supplementary election). Tribunal/court decisions do NOT change the result. Postponement over 30 days voids the market.',
  })),
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const ds = app.get(DataSource);
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@predict.ng';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-now';
  await ds.query(
    `INSERT INTO users (email, phone, full_name, password_hash, role, status) VALUES ($1, $2, 'Market Ops', $3, 'ADMIN', 'ACTIVE') ON CONFLICT (email) DO NOTHING`,
    [email, process.env.SEED_ADMIN_PHONE ?? '+2348000000000', await bcrypt.hash(password, 10)]);
  const [admin] = await ds.query(`SELECT id, email FROM users WHERE email = $1`, [email]);
  const actor: AuthUser = { id: admin.id, email: admin.email, role: 'ADMIN', sessionId: null, fullName: 'Market Ops', phone: '' };
  const markets = app.get(MarketsService);
  let created = 0;
  for (const m of catalogue()) {
    const [exists] = await ds.query(`SELECT 1 FROM markets WHERE slug = $1`, [m.slug]);
    if (exists) continue;
    await markets.create(actor, m);
    created += 1;
  }
  const now = new Date();
  const friday = new Date(now.getTime() + (((5 - now.getUTCDay() + 7) % 7) || 7) * 86_400_000).toISOString().slice(0, 10);
  const spotify = await markets.spotifyWeekly(actor, friday);
  console.log(`seed: admin ${email}; ${created} markets created (${catalogue().length} in catalogue); spotify week ${friday}: ${spotify.message}`);
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
