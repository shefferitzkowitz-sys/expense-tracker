import { splitEvenly, type Agorot } from './money';
import { installmentChargeDate, predictChargeDate } from './billing';
import type { ISODate } from './dates';

export interface InstallmentInput {
  transactionDate: ISODate;
  billingDay: number;
  count: number;
  totalAgorot?: Agorot;
  installmentAgorot?: Agorot;
  /** Charge date of installment #1 if known (explicit); otherwise predicted from the billing rule. */
  firstChargeDate?: ISODate;
}

export interface InstallmentCharge {
  index: number;
  amountAgorot: Agorot;
  chargeDate: ISODate;
}

/** Builds the full installment schedule. Totals are split in whole agorot, remainder on the last charge. */
export function buildInstallments(input: InstallmentInput): InstallmentCharge[] {
  const { count, billingDay } = input;
  if (count < 1) throw new Error('count must be >= 1');
  let amounts: Agorot[];
  if (input.totalAgorot != null) {
    amounts = splitEvenly(input.totalAgorot, count);
  } else if (input.installmentAgorot != null) {
    amounts = Array(count).fill(input.installmentAgorot);
  } else {
    throw new Error('total or installment amount required');
  }
  const first = input.firstChargeDate ?? predictChargeDate(input.transactionDate, billingDay);
  return amounts.map((amountAgorot, i) => ({
    index: i + 1,
    amountAgorot,
    chargeDate: installmentChargeDate(first, billingDay, i + 1),
  }));
}

/**
 * For a screenshot that shows only installment N of M: return the later installments (N+1..M) as
 * suggestions. Earlier installments are never created without evidence.
 */
export function futureInstallmentsFrom(
  knownIndex: number,
  count: number,
  knownChargeDate: ISODate,
  billingDay: number,
  amountAgorot: Agorot,
): InstallmentCharge[] {
  const out: InstallmentCharge[] = [];
  for (let i = knownIndex + 1; i <= count; i++) {
    out.push({ index: i, amountAgorot, chargeDate: installmentChargeDate(knownChargeDate, billingDay, i - knownIndex + 1) });
  }
  return out;
}
