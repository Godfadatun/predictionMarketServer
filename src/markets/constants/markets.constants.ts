export const MARKET_STATUS = { OPEN: 'OPEN', PENDING_RESOLUTION: 'PENDING_RESOLUTION', RESOLVED: 'RESOLVED', VOID: 'VOID' } as const;
export const MARKET_CATEGORY = {
  PRESIDENTIAL: 'PRESIDENTIAL', GOVERNORSHIP: 'GOVERNORSHIP', MUSIC: 'MUSIC', ECONOMY: 'ECONOMY', SPORTS: 'SPORTS', ENTERTAINMENT: 'ENTERTAINMENT',
} as const;
export const MARKET_CODES = {
  MARKET_NOT_FOUND: 'MARKET_NOT_FOUND', SLUG_TAKEN: 'SLUG_TAKEN', MARKET_HAS_TRADES: 'MARKET_HAS_TRADES', MARKET_NOT_OPEN: 'MARKET_NOT_OPEN',
} as const;
export const MARKET_EVENTS = {
  CREATED: 'markets.market.create.success', UPDATED: 'markets.market.update.success', CLOSED: 'markets.market.close.success',
} as const;
export const MARKET_WARNINGS = { PRICES_NORMALIZED: 'PRICES_NORMALIZED', ALREADY_EXISTS: 'ALREADY_EXISTS' } as const;
export const MIN_INITIAL_PRICE = 0.01; // caps house worst-case loss at b·ln(100)
export const PRICE_SUM_TOLERANCE = 0.01;
export const RULE_FIELDS = ['resolutionRules', 'resolutionSource', 'title'] as const; // frozen once anyone has traded
export const SPOTIFY_WEEKLY = {
  SLUG_PREFIX: 'spotify-ng-weekly-',
  LIQUIDITY_B: 200,
  ARTISTS: ['Burna Boy', 'Wizkid', 'Davido', 'Asake', 'Rema', 'Ayra Starr', 'Seyi Vibez', 'Other artist'],
  SOURCE: 'charts.spotify.com → Weekly Top Songs → Nigeria',
  CRON: '0 11 * * 3', // Wednesdays 12:00 WAT (11:00 UTC): open next week's market
  CLOSE_OFFSET_MS: 60 * 60 * 1000, // closes 23:00 WAT the Thursday before the chart week starts
} as const;
export const DEFAULT_LIQUIDITY_B = 1000;
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
  'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;
