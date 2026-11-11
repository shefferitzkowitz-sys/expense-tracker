import type { MerchantRule } from './types';

/** Normalizes merchant text for matching: lowercase, no punctuation/geresh, no company suffixes, single spaces. */
export function normalizeMerchant(s: string): string {
  return s
    .toLowerCase()
    .replace(/בע["״']?מ/g, ' ')
    .replace(/\b(ltd|inc|co)\b\.?/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s/g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient on character bigrams of normalized text, 0..1. */
export function merchantSimilarity(a: string, b: string): number {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return 0.9;
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  let total = 0;
  for (const [, v] of A) total += v;
  for (const [g, v] of B) {
    total += v;
    inter += Math.min(v, A.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * inter) / total;
}

/** Suggests a category from local merchant rules (exact normalized match first, then containment). */
export function suggestCategory(merchant: string, rules: MerchantRule[]): string | undefined {
  const n = normalizeMerchant(merchant);
  if (!n) return undefined;
  const enabled = rules.filter((r) => r.enabled);
  const exact = enabled.find((r) => r.normalizedMerchant === n);
  if (exact) return exact.categoryId;
  const contained = enabled
    .filter((r) => r.normalizedMerchant.length >= 3 && n.includes(r.normalizedMerchant))
    .sort((a, b) => b.normalizedMerchant.length - a.normalizedMerchant.length)[0];
  return contained?.categoryId;
}
