import { describe, expect, it } from 'vitest';
import { loanOccurrences } from '../src/lib/loans';
import { chargeLines, summarizeMonth } from '../src/lib/analytics';
import type { Loan, Transaction } from '../src/lib/types';
import { UNCATEGORIZED } from '../src/lib/types';

const TODAY = '2026-11-11';
const car: Loan = { id: 'L1', name: 'הלוואת רכב', monthlyAmountAgorot: 150000, billingDay: 2, startDate: '2026-01-01', categoryId: 'car', active: true };

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(), sourceType: 'card', cardId: 'C1', merchant: 'x', transactionDate: '2026-11-01', amountAgorot: 1000,
    chargeDate: '2026-11-10', chargeDateSource: 'predicted', status: 'confirmed', createdAt: '', updatedAt: '', ...p,
  };
}

describe('loans (spec §6)', () => {
  it('1,500 ILS loan in the car category counts in the right month and category', () => {
    const lines = chargeLines([], [car], [], '2026-11', '2026-11', TODAY);
    const s = summarizeMonth(lines, '2026-11', TODAY);
    expect(s.loans).toBe(150000);
    expect(s.byCategory.get('car')).toBe(150000);
    expect(s.total).toBe(150000);
  });
  it('open-ended loans forecast 12 months ahead only', () => {
    const occ = loanOccurrences(car, [], '2026-01', '2030-01', TODAY);
    expect(occ[occ.length - 1].chargeDate).toBe('2027-11-02');
  });
  it('a one-off override changes one month only', () => {
    const occ = loanOccurrences(car, [{ id: 'o', loanId: 'L1', chargeDate: '2026-12-02', amountAgorot: 160000 }], '2026-12', '2027-01', TODAY);
    expect(occ.map((o) => o.amountAgorot)).toEqual([160000, 150000]);
  });
  it('permanent change applies from its date onward', () => {
    const l = { ...car, amountChanges: [{ fromDate: '2027-01-01', amountAgorot: 140000 }] };
    expect(loanOccurrences(l, [], '2026-12', '2027-02', TODAY).map((o) => o.amountAgorot)).toEqual([150000, 140000, 140000]);
  });
  it('end date stops occurrences', () => {
    const l = { ...car, endDate: '2026-03-15' };
    expect(loanOccurrences(l, [], '2026-01', '2026-12', TODAY).length).toBe(3);
  });
});

describe('month summary (spec §10)', () => {
  it('uncategorized transactions count in the total and as their own group', () => {
    const lines = chargeLines([tx({ amountAgorot: 5000 }), tx({ amountAgorot: 2000, categoryId: 'food' })], [], [], '2026-11', '2026-11', TODAY);
    const s = summarizeMonth(lines, '2026-11', TODAY);
    expect(s.total).toBe(7000);
    expect(s.byCategory.get(UNCATEGORIZED)).toBe(5000);
  });
  it('excluded lines are not counted; future month is a partial forecast', () => {
    const lines = chargeLines([tx({ chargeDate: '2026-12-10', status: 'excluded' }), tx({ chargeDate: '2026-12-10', status: 'predicted' })], [], [], '2026-12', '2026-12', TODAY);
    const s = summarizeMonth(lines, '2026-12', '2026-11-05');
    expect(s.total).toBe(1000);
    expect(s.predicted).toBe(1000);
    expect(s.isFuture).toBe(true);
  });
});

import { budgetMonth, budgetRange, setCycleEndDay } from '../src/lib/dates';
describe('budget month (cycle ends on the 10th)', () => {
  it('a charge on the 10th belongs to that month; after the 10th to the next', () => {
    setCycleEndDay(10);
    expect(budgetMonth('2026-11-10')).toBe('2026-11');
    expect(budgetMonth('2026-11-11')).toBe('2026-12');
    expect(budgetMonth('2026-11-15')).toBe('2026-12');
    expect(budgetMonth('2026-12-31')).toBe('2027-01');
    expect(budgetRange('2026-11')).toEqual(['2026-10-11', '2026-11-10']);
  });
  it('a loan charged on the 15th shows in the next month', () => {
    setCycleEndDay(10);
    const loan = { id: 'L', name: 'הלוואה', monthlyAmountAgorot: 100000, billingDay: 15, startDate: '2026-01-01', active: true, createdAt: '', updatedAt: '' };
    const nov = chargeLines([], [loan as never], [], '2026-11', '2026-11', '2026-11-12');
    const dec = chargeLines([], [loan as never], [], '2026-12', '2026-12', '2026-11-12');
    expect(nov.map((l) => l.chargeDate)).toEqual(['2026-10-15']);
    expect(dec.map((l) => l.chargeDate)).toEqual(['2026-11-15']);
  });
  it('0 means calendar months', () => {
    setCycleEndDay(0);
    expect(budgetMonth('2026-11-15')).toBe('2026-11');
    setCycleEndDay(10);
  });
});
