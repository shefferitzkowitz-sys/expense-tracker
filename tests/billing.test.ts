import { describe, expect, it } from 'vitest';
import { predictChargeDate } from '../src/lib/billing';
import { buildInstallments, futureInstallmentsFrom } from '../src/lib/installments';
import { splitEvenly, parseAmount } from '../src/lib/money';

describe('billing rule (spec §4, §14)', () => {
  it('card billed on the 10th', () => {
    expect(predictChargeDate('2026-11-09', 10)).toBe('2026-11-10');
    expect(predictChargeDate('2026-11-10', 10)).toBe('2026-12-10');
    expect(predictChargeDate('2026-11-30', 10)).toBe('2026-12-10');
    expect(predictChargeDate('2026-12-09', 10)).toBe('2026-12-10');
    expect(predictChargeDate('2026-12-10', 10)).toBe('2027-01-10');
  });
  it('cards with billing days 10, 12, 15 give separate dates', () => {
    const d = '2026-11-11';
    expect([10, 12, 15].map((b) => predictChargeDate(d, b))).toEqual(['2026-12-10', '2026-11-12', '2026-11-15']);
  });
  it('billing day 31 falls on the last day of short months', () => {
    expect(predictChargeDate('2027-02-05', 31)).toBe('2027-02-28');
    expect(predictChargeDate('2027-02-28', 31)).toBe('2027-03-31');
  });
});

describe('installments (spec §5)', () => {
  it('3 × 100 ILS is 100 in each of three charge months, not 300 in the purchase month', () => {
    const plan = buildInstallments({ transactionDate: '2026-11-05', billingDay: 10, count: 3, totalAgorot: 30000 });
    expect(plan).toEqual([
      { index: 1, amountAgorot: 10000, chargeDate: '2026-11-10' },
      { index: 2, amountAgorot: 10000, chargeDate: '2026-12-10' },
      { index: 3, amountAgorot: 10000, chargeDate: '2027-01-10' },
    ]);
  });
  it('rounding remainder goes to the last installment', () => {
    expect(splitEvenly(10000, 3)).toEqual([3333, 3333, 3334]);
  });
  it('N of M shows only later installments as suggestions', () => {
    const f = futureInstallmentsFrom(2, 4, '2026-12-10', 10, 5000);
    expect(f.map((x) => [x.index, x.chargeDate])).toEqual([[3, '2027-01-10'], [4, '2027-02-10']]);
  });
});

describe('amount parsing', () => {
  it('parses shekel formats', () => {
    expect(parseAmount('1,234.50')).toBe(123450);
    expect(parseAmount('₪ 99.90')).toBe(9990);
    expect(parseAmount('45.00-')).toBe(-4500);
    expect(parseAmount('abc')).toBeNull();
  });
});

import { nearBillingDay } from '../src/services/importer';
describe('statement charge date sanity', () => {
  it('accepts dates near the billing day and rejects others', () => {
    expect(nearBillingDay('2026-11-10', 10)).toBe(true);
    expect(nearBillingDay('2026-11-12', 10)).toBe(true); // moved for a weekend
    expect(nearBillingDay('2026-11-05', 10)).toBe(false);
    expect(nearBillingDay('2026-11-02', 2)).toBe(true);
    expect(nearBillingDay('2026-10-30', 2)).toBe(true);
  });
});
