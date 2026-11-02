export interface ProposeInput { outcomeId?: string; void?: boolean; sourceUrl: string; note?: string }
export interface ResolutionView {
  marketId: string; status: string; outcomeId: string | null; isVoid: boolean; sourceUrl: string; note: string | null;
  proposedBy: string; confirmedBy: string | null; proposedAt: Date; confirmedAt: Date | null;
}
export interface SettlementResult extends ResolutionView { totalPaidKobo: number; winners: number }
export interface Payout { positionId: string; userId: string; amountKobo: number }
