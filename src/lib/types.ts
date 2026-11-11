import type { Agorot } from './money';
import type { ISODate } from './dates';

export type SourceType = 'card' | 'manual';
export type TxStatus = 'predicted' | 'confirmed' | 'excluded';
export type ChargeDateSource = 'predicted' | 'explicit' | 'manual';

export interface Card {
  id: string;
  name: string;
  billingDay: number; // 1–31; 29–31 fall on the month's last day when shorter
  active: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isSystem: boolean; // default categories; still renamable/deletable except UNCATEGORIZED (virtual)
}

export interface Transaction {
  id: string;
  sourceType: SourceType;
  cardId?: string;
  merchant: string;
  transactionDate: ISODate;
  amountAgorot: Agorot; // the charge amount (for installments: this installment)
  totalAgorot?: Agorot; // original deal total, installments only (never summed)
  categoryId?: string;
  chargeDate: ISODate;
  chargeDateSource: ChargeDateSource;
  status: TxStatus;
  installmentGroupId?: string;
  installmentIndex?: number;
  installmentCount?: number;
  importBatchId?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Loan {
  id: string;
  name: string;
  monthlyAmountAgorot: Agorot;
  billingDay: number;
  startDate: ISODate;
  endDate?: ISODate;
  categoryId?: string;
  active: boolean;
  /** Permanent amount changes from a date onward (the "apply to following months" choice). */
  amountChanges?: { fromDate: ISODate; amountAgorot: Agorot }[];
}

export interface LoanOverride {
  id: string;
  loanId: string;
  chargeDate: ISODate; // the predicted occurrence date this override replaces (stable key)
  actualDate?: ISODate;
  amountAgorot?: Agorot;
  excluded?: boolean;
  confirmed?: boolean;
  note?: string;
}

export interface MerchantRule {
  id: string;
  normalizedMerchant: string;
  categoryId: string;
  enabled: boolean;
}

export interface ImportBatch {
  id: string;
  createdAt: string;
  sourceCardId?: string;
  imageCount: number;
  importedCount: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

/** A monthly charge line used for totals: a transaction or a loan occurrence. */
export interface ChargeLine {
  key: string;
  kind: 'transaction' | 'loan';
  refId: string;
  loanId?: string;
  occurrenceDate?: ISODate;
  sourceType: SourceType | 'loan';
  cardId?: string;
  merchant: string;
  chargeDate: ISODate;
  amountAgorot: Agorot;
  categoryId?: string;
  status: TxStatus;
}

export const UNCATEGORIZED = '__uncategorized__';
