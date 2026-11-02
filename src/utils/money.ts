export const KOBO_PER_NAIRA = 100;
export const PAYOUT_PER_SHARE_KOBO = 10_000; // a winning share pays ₦100

export const nairaToKobo = (naira: number): number => Math.round(naira * KOBO_PER_NAIRA);
export const koboToNaira = (kobo: number): number => kobo / KOBO_PER_NAIRA;
export const bpsOf = (kobo: number, bps: number): number => Math.ceil((kobo * bps) / 10_000);
