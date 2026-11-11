import { merchantSimilarity } from './merchant';
import type { ISODate } from './dates';
import type { Transaction } from './types';

export interface Candidate {
  cardId?: string;
  merchant: string;
  transactionDate: ISODate;
  chargeDate: ISODate;
  amountAgorot: number;
  installmentGroupId?: string;
  installmentIndex?: number;
  installmentCount?: number;
}

export type MatchKind = 'certain' | 'possible' | 'installment-forecast';

export interface DuplicateMatch {
  candidateIndex: number;
  existingId: string;
  kind: MatchKind;
  score: number;
  reasons: string[];
}

function daysApart(a: ISODate, b: ISODate): number {
  const da = new Date(a + 'T00:00:00');
  const dbb = new Date(b + 'T00:00:00');
  return Math.abs(Math.round((da.getTime() - dbb.getTime()) / 86400000));
}

/** Scores how likely a candidate is the same charge as an existing transaction (0..1). */
export function scoreMatch(c: Candidate, t: Transaction): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (c.cardId && t.cardId && c.cardId !== t.cardId) return { score: 0, reasons };
  if (c.amountAgorot !== t.amountAgorot) return { score: 0, reasons };
  reasons.push('אותו סכום');
  let score = 0.35;
  if (c.transactionDate === t.transactionDate) {
    score += 0.25;
    reasons.push('אותו תאריך עסקה');
  } else if (daysApart(c.transactionDate, t.transactionDate) <= 2) {
    score += 0.1;
    reasons.push('תאריך קרוב');
  } else if (!(c.installmentIndex && c.installmentIndex === t.installmentIndex)) {
    return { score: 0, reasons: [] };
  }
  const sim = merchantSimilarity(c.merchant, t.merchant);
  if (sim >= 0.85) {
    score += 0.3;
    reasons.push('אותו בית עסק');
  } else if (sim >= 0.6) {
    score += 0.15;
    reasons.push('בית עסק דומה');
  } else {
    score -= 0.2;
  }
  if (c.installmentIndex && t.installmentIndex) {
    if (c.installmentIndex === t.installmentIndex && c.installmentCount === t.installmentCount) {
      score += 0.1;
      reasons.push(`תשלום ${c.installmentIndex}/${c.installmentCount}`);
    } else return { score: 0, reasons: [] };
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/**
 * Finds duplicates of import candidates among existing transactions. Each existing transaction can
 * match at most one candidate, so two legitimate identical charges on the same day stay separate.
 * Nothing is deleted or merged here; the caller shows matches for user approval.
 */
export function findDuplicates(candidates: Candidate[], existing: Transaction[], threshold = 0.6): DuplicateMatch[] {
  const all: DuplicateMatch[] = [];
  candidates.forEach((c, candidateIndex) => {
    for (const t of existing) {
      if (t.status === 'excluded') continue;
      if (c.installmentGroupId && c.installmentGroupId === t.installmentGroupId && c.installmentIndex === t.installmentIndex) {
        all.push({ candidateIndex, existingId: t.id, kind: 'certain', score: 1, reasons: ['אותה קבוצת תשלומים'] });
        continue;
      }
      const { score, reasons } = scoreMatch(c, t);
      if (score >= threshold) {
        const kind: MatchKind = t.status === 'predicted' && t.installmentGroupId ? 'installment-forecast' : 'possible';
        all.push({ candidateIndex, existingId: t.id, kind, score, reasons });
      }
    }
  });
  all.sort((a, b) => b.score - a.score);
  const usedExisting = new Set<string>();
  const usedCandidate = new Set<number>();
  const out: DuplicateMatch[] = [];
  for (const m of all) {
    if (usedExisting.has(m.existingId) || usedCandidate.has(m.candidateIndex)) continue;
    usedExisting.add(m.existingId);
    usedCandidate.add(m.candidateIndex);
    out.push(m);
  }
  return out.sort((a, b) => a.candidateIndex - b.candidateIndex);
}

/** Loan occurrence that looks like an imported card line (same month, amount within 2%). */
export function matchesLoan(amountAgorot: number, chargeDate: ISODate, merchant: string, occurrence: { chargeDate: ISODate; amountAgorot: number; merchant: string }): boolean {
  if (chargeDate.slice(0, 7) !== occurrence.chargeDate.slice(0, 7)) return false;
  const diff = Math.abs(amountAgorot - occurrence.amountAgorot);
  const closeAmount = diff <= Math.max(100, occurrence.amountAgorot * 0.02);
  return closeAmount && (diff === 0 || merchantSimilarity(merchant, occurrence.merchant) >= 0.5);
}
