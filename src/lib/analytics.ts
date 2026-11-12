import { addMonths, budgetMonth, compareMonths, monthOf, todayLocal, type ISODate, type MonthKey } from './dates';
import { loanOccurrences } from './loans';
import { UNCATEGORIZED, type ChargeLine, type Loan, type LoanOverride, type Transaction } from './types';

/** Month a charge line is counted in: card charges by the month they are charged; everything else by budget month. */
export function lineMonth(l: Pick<ChargeLine, 'kind' | 'sourceType' | 'chargeDate'>): MonthKey {
  return l.kind === 'transaction' && l.sourceType === 'card' ? monthOf(l.chargeDate) : budgetMonth(l.chargeDate);
}

export function transactionLine(t: Transaction): ChargeLine {
  return {
    key: `tx:${t.id}`,
    kind: 'transaction',
    refId: t.id,
    sourceType: t.sourceType,
    cardId: t.cardId,
    paymentMethod: t.paymentMethod,
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
  const inRange = (l: ChargeLine) => compareMonths(lineMonth(l), from) >= 0 && compareMonths(lineMonth(l), to) <= 0;
  const lines = transactions.map(transactionLine).filter(inRange);
  for (const loan of loans) lines.push(...loanOccurrences(loan, overrides, addMonths(from, -1), to, today).filter(inRange));
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
    isFuture: compareMonths(month, budgetMonth(today)) > 0,
    isPartialForecast: compareMonths(month, budgetMonth(today)) >= 0,
    count: 0,
  };
  for (const l of lines) {
    if (lineMonth(l) !== month || l.status === 'excluded') continue;
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
