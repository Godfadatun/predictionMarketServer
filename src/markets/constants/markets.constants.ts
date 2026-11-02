export const MARKET_STATUS = { OPEN: 'OPEN', PENDING_RESOLUTION: 'PENDING_RESOLUTION', RESOLVED: 'RESOLVED', VOID: 'VOID' } as const;
export const MARKET_CATEGORY = {
  PRESIDENTIAL: 'PRESIDENTIAL', GOVERNORSHIP: 'GOVERNORSHIP', MUSIC: 'MUSIC', ECONOMY: 'ECONOMY', SPORTS: 'SPORTS', ENTERTAINMENT: 'ENTERTAINMENT',
} as const;
export const MARKET_CODES = { MARKET_NOT_FOUND: 'MARKET_NOT_FOUND', SLUG_TAKEN: 'SLUG_TAKEN' } as const;
export const MARKET_EVENTS = { CREATED: 'markets.market.create.success' } as const;
export const DEFAULT_LIQUIDITY_B = 1000;
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
  'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;
