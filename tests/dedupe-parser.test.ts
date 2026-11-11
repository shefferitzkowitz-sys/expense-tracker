import { describe, expect, it } from 'vitest';
import { findDuplicates } from '../src/lib/dedupe';
import { parseStatement } from '../src/lib/ocrParser';
import { normalizeMerchant, suggestCategory } from '../src/lib/merchant';
import type { Transaction } from '../src/lib/types';

const base: Transaction = {
  id: 'T1', sourceType: 'card', cardId: 'C1', merchant: 'שופרסל דיל', transactionDate: '2026-10-14', amountAgorot: 24590,
  chargeDate: '2026-11-10', chargeDateSource: 'predicted', status: 'confirmed', createdAt: '', updatedAt: '',
};

describe('duplicates (spec §8)', () => {
  it('re-importing the same line is a possible duplicate', () => {
    const m = findDuplicates([{ cardId: 'C1', merchant: 'שופרסל דיל בע"מ', transactionDate: '2026-10-14', chargeDate: '2026-11-10', amountAgorot: 24590 }], [base]);
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe('possible');
  });
  it('two legitimate identical charges: only one matches the single existing one', () => {
    const c = { cardId: 'C1', merchant: 'שופרסל דיל', transactionDate: '2026-10-14', chargeDate: '2026-11-10', amountAgorot: 24590 };
    expect(findDuplicates([c, c], [base])).toHaveLength(1);
  });
  it('different card never matches', () => {
    expect(findDuplicates([{ cardId: 'C2', merchant: 'שופרסל דיל', transactionDate: '2026-10-14', chargeDate: '2026-11-10', amountAgorot: 24590 }], [base])).toHaveLength(0);
  });
  it('an imported installment matches its forecast row', () => {
    const forecast = { ...base, id: 'F2', status: 'predicted' as const, installmentGroupId: 'G', installmentIndex: 2, installmentCount: 3, transactionDate: '2026-09-01', amountAgorot: 10000 };
    const m = findDuplicates([{ cardId: 'C1', merchant: 'שופרסל דיל', transactionDate: '2026-09-01', chargeDate: '2026-11-10', amountAgorot: 10000, installmentIndex: 2, installmentCount: 3 }], [forecast]);
    expect(m[0].kind).toBe('installment-forecast');
  });
});

describe('statement parser (spec §7)', () => {
  it('reads date, merchant, amount, installments and date headers', () => {
    const { drafts } = parseStatement([
      { text: '14/10/2026 שופרסל דיל 245.90', confidence: 92 },
      { text: 'יום ג׳, 15 באוקטובר', confidence: 90 },
      { text: 'ACE ראשון לציון תשלום 2 מתוך 6 ₪ 99.90', confidence: 88 },
      { text: 'סה"כ 345.80', confidence: 95 },
      { text: 'blurred text', confidence: 20 },
    ], '2026-11-11');
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ transactionDate: '2026-10-14', merchant: 'שופרסל דיל', amountAgorot: 24590 });
    expect(drafts[1]).toMatchObject({ transactionDate: '2026-10-15', amountAgorot: 9990, installmentIndex: 2, installmentCount: 6 });
    expect(drafts[1].merchant).toContain('ACE');
  });
  it('detects an explicit charge date', () => {
    const r = parseStatement([{ text: 'מועד חיוב 10/11/26', confidence: 90 }, { text: '01/10/26 סונול 120.00', confidence: 90 }], '2026-11-11');
    expect(r.explicitChargeDate).toBe('2026-11-10');
    expect(r.drafts[0].explicitChargeDate).toBe('2026-11-10');
  });
});

describe('merchant rules (spec §3)', () => {
  it('suggests category from a local rule', () => {
    const rules = [{ id: 'r', normalizedMerchant: normalizeMerchant('סונול'), categoryId: 'car', enabled: true }];
    expect(suggestCategory('סונול רמת גן', rules)).toBe('car');
  });
});

describe('statement parser layouts', () => {
  it('date (and installments) on the line under the merchant', () => {
    const { drafts } = parseStatement([
      { text: 'שופרסל דיל ₪245.90', confidence: 90 },
      { text: '14/10/2026', confidence: 90 },
      { text: 'ACE רמת גן ₪ 99.90', confidence: 90 },
      { text: '16/10/2026 תשלום 2 מתוך 6', confidence: 90 },
    ], '2026-11-11');
    expect(drafts.map((d) => [d.transactionDate, d.amountAgorot, d.installmentIndex, d.installmentCount])).toEqual([
      ['2026-10-14', 24590, undefined, undefined],
      ['2026-10-16', 9990, 2, 6],
    ]);
    expect(drafts[0].uncertain).not.toContain('transactionDate');
  });
  it('numeric date header above a group', () => {
    const { drafts } = parseStatement([
      { text: '14/10/2026', confidence: 90 },
      { text: 'שופרסל ₪245.90', confidence: 90 },
      { text: 'פז ₪100.00', confidence: 90 },
      { text: '15/10/2026', confidence: 90 },
      { text: 'קפה ₪20.00', confidence: 90 },
    ], '2026-11-11');
    expect(drafts.map((d) => d.transactionDate)).toEqual(['2026-10-14', '2026-10-14', '2026-10-15']);
  });
});
