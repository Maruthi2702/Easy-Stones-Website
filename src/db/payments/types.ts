export interface PaymentFigure { method: string; cents: number; voidedAt: Date | null }

export interface PaymentHistoryEntry {
  at: Date;
  by: string;
  action: 'added' | 'edited' | 'voided';
  changes?: string;
}
