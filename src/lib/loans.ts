import { addMonths, compareMonths, dayInMonth, monthOf, monthsBetween, parts, todayLocal, type ISODate, type MonthKey } from './dates';
import type { ChargeLine, Loan, LoanOverride } from './types';

export const OPEN_ENDED_HORIZON_MONTHS = 12;

/** First billing date on or after the loan's start date. */
export function firstLoanCharge(loan: Loan): ISODate {
  const m = monthOf(loan.startDate);
  const candidate = dayInMonth(m, loan.billingDay);
  return candidate >= loan.startDate ? candidate : dayInMonth(addMonths(m, 1), loan.billingDay);
}

export function loanAmountOn(loan: Loan, date: ISODate): number {
  let amount = loan.monthlyAmountAgorot;
  const changes = [...(loan.amountChanges ?? [])].sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  for (const c of changes) if (c.fromDate <= date) amount = c.amountAgorot;
  return amount;
}

/** Last month that will be forecast for this loan, and whether the end is unknown. */
export function loanLastMonth(loan: Loan, today: ISODate = todayLocal()): { month: MonthKey; openEnded: boolean } {
  if (loan.endDate) return { month: monthOf(loan.endDate), openEnded: false };
  return { month: addMonths(monthOf(today), OPEN_ENDED_HORIZON_MONTHS), openEnded: true };
}

/**
 * Loan occurrences are computed, not stored (one approach, so no duplicates). An override keyed by
 * (loanId, predicted chargeDate) changes or excludes a single occurrence.
 */
export function loanOccurrences(
  loan: Loan,
  overrides: LoanOverride[],
  from: MonthKey,
  to: MonthKey,
  today: ISODate = todayLocal(),
): ChargeLine[] {
  if (!loan.active) return [];
  const first = monthOf(firstLoanCharge(loan));
  const { month: last } = loanLastMonth(loan, today);
  const start = compareMonths(first, from) > 0 ? first : from;
  const end = compareMonths(last, to) < 0 ? last : to;
  if (compareMonths(start, end) > 0) return [];
  const byDate = new Map(overrides.filter((o) => o.loanId === loan.id).map((o) => [o.chargeDate, o]));
  const lines: ChargeLine[] = [];
  for (const m of monthsBetween(start, end)) {
    const occurrenceDate = dayInMonth(m, loan.billingDay);
    if (loan.endDate && occurrenceDate > loan.endDate) continue;
    const ov = byDate.get(occurrenceDate);
    const chargeDate = ov?.actualDate ?? occurrenceDate;
    const status = ov?.excluded ? 'excluded' : ov?.confirmed || chargeDate <= today ? 'confirmed' : 'predicted';
    lines.push({
      key: `loan:${loan.id}:${occurrenceDate}`,
      kind: 'loan',
      refId: loan.id,
      loanId: loan.id,
      occurrenceDate,
      sourceType: 'loan',
      merchant: loan.name,
      chargeDate,
      amountAgorot: ov?.amountAgorot ?? loanAmountOn(loan, occurrenceDate),
      categoryId: loan.categoryId,
      status,
    });
  }
  return lines;
}

export function dayOf(date: ISODate): number {
  return parts(date)[2];
}
