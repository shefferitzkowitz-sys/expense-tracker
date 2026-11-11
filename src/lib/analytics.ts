import { compareMonths, monthOf, todayLocal, type ISODate, type MonthKey } from './dates';
import { loanOccurrences } from './loans';
import { UNCATEGORIZED, type ChargeLine, type Loan, type LoanOverride, type Transaction } from './types';

export function transactionLine(t: Transaction): ChargeLine {
  return {
    key: `tx:${t.id}`,
    kind: 'transaction',
    refId: t.id,
    sourceType: t.sourceType,
    cardId: t.cardId,
    merchant: t.merchant,
    chargeDate: t.chargeDate,
    amountAgorot: t.amountAgorot,
    categoryId: t.categoryId,
    status: t.status,
  };
}

/** All charge lines (transactions + computed loan occurrences) whose charge month is within [from, to]. */
export function chargeLines(
  transactions: Transaction[],
  loans: Loan[],
  overrides: LoanOverride[],
  from: MonthKey,
  to: MonthKey,
  today: ISODate = todayLocal(),
): ChargeLine[] {
  const inRange = (d: ISODate) => compareMonths(monthOf(d), from) >= 0 && compareMonths(monthOf(d), to) <= 0;
  const lines = transactions.filter((t) => inRange(t.chargeDate)).map(transactionLine);
  for (const loan of loans) lines.push(...loanOccurrences(loan, overrides, from, to, today).filter((l) => inRange(l.chargeDate)));
  return lines.sort((a, b) => a.chargeDate.localeCompare(b.chargeDate));
}

export interface MonthSummary {
  month: MonthKey;
  total: number;
  cardAndManual: number;
  loans: number;
  confirmed: number;
  predicted: number;
  byCategory: Map<string, number>; // UNCATEGORIZED key for none
  bySource: Map<string, number>; // cardId | 'manual' | 'loan'
  isFuture: boolean;
  isPartialForecast: boolean;
  count: number;
}

/** Monthly total = all counted charges in the charge month. Excluded lines are never counted. */
export function summarizeMonth(lines: ChargeLine[], month: MonthKey, today: ISODate = todayLocal()): MonthSummary {
  const s: MonthSummary = {
    month,
    total: 0,
    cardAndManual: 0,
    loans: 0,
    confirmed: 0,
    predicted: 0,
    byCategory: new Map(),
    bySource: new Map(),
    isFuture: compareMonths(month, monthOf(today)) > 0,
    isPartialForecast: compareMonths(month, monthOf(today)) >= 0,
    count: 0,
  };
  for (const l of lines) {
    if (monthOf(l.chargeDate) !== month || l.status === 'excluded') continue;
    s.total += l.amountAgorot;
    s.count++;
    if (l.kind === 'loan') s.loans += l.amountAgorot;
    else s.cardAndManual += l.amountAgorot;
    if (l.status === 'predicted') s.predicted += l.amountAgorot;
    else s.confirmed += l.amountAgorot;
    const cat = l.categoryId ?? UNCATEGORIZED;
    s.byCategory.set(cat, (s.byCategory.get(cat) ?? 0) + l.amountAgorot);
    const src = l.kind === 'loan' ? 'loan' : l.sourceType === 'manual' ? 'manual' : l.cardId ?? 'manual';
    s.bySource.set(src, (s.bySource.get(src) ?? 0) + l.amountAgorot);
  }
  return s;
}
