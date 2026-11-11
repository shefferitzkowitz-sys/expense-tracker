import { db, nowIso, uid } from '../db';
import { futureInstallmentsFrom } from '../lib/installments';
import { findDuplicates, matchesLoan, type MatchKind } from '../lib/dedupe';
import { merchantSimilarity, suggestCategory } from '../lib/merchant';
import { predictChargeDate } from '../lib/billing';
import { loanOccurrences } from '../lib/loans';
import { addMonths, monthOf, todayLocal, type ISODate } from '../lib/dates';
import type { Draft } from '../lib/ocrParser';
import type { ChargeDateSource, Transaction } from '../lib/types';
import { rememberMerchantCategory } from './transactions';

export type DupAction = 'skip' | 'merge' | 'keep';

export interface ReviewRow {
  key: string;
  imageIndex: number;
  include: boolean;
  transactionDate: ISODate | '';
  merchant: string;
  amountAgorot: number | null;
  categoryId?: string;
  categoryTouched?: boolean;
  chargeDate: ISODate | '';
  chargeDateSource: ChargeDateSource;
  installmentIndex?: number;
  installmentCount?: number;
  createFuture: boolean;
  uncertain: string[];
  rawText: string;
  duplicate?: { existingId: string; kind: MatchKind; reasons: string[]; summary: string; action: DupAction };
  loanMatch?: { loanId: string; loanName: string; occurrenceDate: ISODate; action: 'merge' | 'keep' };
}

/** Converts parser drafts into editable review rows with predicted charge dates and suggested categories. */
export async function draftsToRows(drafts: Draft[], imageIndex: number, cardId: string): Promise<ReviewRow[]> {
  const card = await db.cards.get(cardId);
  const rules = await db.merchantRules.toArray();
  return drafts.map((d, i) => {
    let chargeDate: ISODate | '' = '';
    let chargeDateSource: ChargeDateSource = 'predicted';
    if (d.explicitChargeDate) {
      chargeDate = d.explicitChargeDate;
      chargeDateSource = 'explicit';
    } else if (d.transactionDate && card) {
      chargeDate = predictChargeDate(d.transactionDate, card.billingDay);
    }
    return {
      key: `${imageIndex}-${i}-${uid()}`,
      imageIndex,
      include: true,
      transactionDate: d.transactionDate ?? '',
      merchant: d.merchant,
      amountAgorot: d.amountAgorot ?? null,
      categoryId: suggestCategory(d.merchant, rules),
      chargeDate,
      chargeDateSource,
      installmentIndex: d.installmentIndex,
      installmentCount: d.installmentCount,
      createFuture: !!(d.installmentIndex && d.installmentCount && d.installmentIndex < d.installmentCount),
      uncertain: d.uncertain,
      rawText: d.rawText,
    };
  });
}

export function rowIsValid(r: ReviewRow): boolean {
  return !!r.transactionDate && !!r.chargeDate && r.amountAgorot != null && r.merchant.trim().length > 0;
}

/** Marks possible duplicates (against saved transactions) and loan repayments; never removes anything. */
export async function annotateDuplicates(rows: ReviewRow[], cardId: string): Promise<ReviewRow[]> {
  const valid = rows.filter(rowIsValid);
  if (valid.length === 0) return rows;
  const dates = valid.map((r) => r.chargeDate as string).sort();
  const from = addMonths(monthOf(dates[0]), -2);
  const to = addMonths(monthOf(dates[dates.length - 1]), 2);
  const existing = await db.transactions.where('chargeDate').between(`${from}-01`, `${to}-31`, true, true).toArray();
  const byId = new Map(existing.map((t) => [t.id, t]));
  const matches = findDuplicates(
    valid.map((r) => ({
      cardId, merchant: r.merchant, transactionDate: r.transactionDate as string, chargeDate: r.chargeDate as string,
      amountAgorot: r.amountAgorot as number, installmentIndex: r.installmentIndex, installmentCount: r.installmentCount,
    })),
    existing,
  );
  const loans = (await db.loans.toArray()).filter((l) => l.active);
  const overrides = await db.loanOverrides.toArray();
  const occurrences = loans.flatMap((l) => loanOccurrences(l, overrides, from, to));
  const usedOcc = new Set<string>();

  const annotated = rows.map((r) => {
    const idx = valid.indexOf(r);
    const out: ReviewRow = { ...r, duplicate: undefined, loanMatch: undefined };
    if (idx < 0) return out;
    const m = matches.find((x) => x.candidateIndex === idx);
    if (m) {
      const t = byId.get(m.existingId) as Transaction;
      const summary = `${t.merchant} · ${t.transactionDate.split('-').reverse().join('/')}`;
      out.duplicate = { existingId: m.existingId, kind: m.kind, reasons: m.reasons, summary, action: m.kind === 'possible' ? 'skip' : 'merge' };
      return out;
    }
    const occ = occurrences.find((o) => !usedOcc.has(o.key) && o.status !== 'excluded' && matchesLoan(r.amountAgorot as number, r.chargeDate as string, r.merchant, o));
    if (occ) {
      usedOcc.add(occ.key);
      out.loanMatch = { loanId: occ.loanId!, loanName: occ.merchant, occurrenceDate: occ.occurrenceDate!, action: 'merge' };
    }
    return out;
  });
  return markCrossImageOverlaps(annotated);
}

/**
 * Overlapping screenshots of the same list show the same line twice. A row identical to one in an
 * earlier image is flagged (default: skip). Identical rows inside the same image are left alone,
 * because two equal charges on the same day can be legitimate.
 */
export function markCrossImageOverlaps(rows: ReviewRow[]): ReviewRow[] {
  const taken = new Set<string>();
  return rows.map((r, i) => {
    if (r.duplicate || r.loanMatch || !rowIsValid(r)) return r;
    const twin = rows.findIndex((o, j) =>
      j < i && !taken.has(o.key) && o.imageIndex !== r.imageIndex && rowIsValid(o) && o.amountAgorot === r.amountAgorot &&
      o.transactionDate === r.transactionDate && merchantSimilarity(o.merchant, r.merchant) >= 0.85);
    if (twin < 0) return r;
    taken.add(rows[twin].key);
    return { ...r, duplicate: { existingId: '', kind: 'possible', reasons: ['מופיע גם בתמונה ' + (rows[twin].imageIndex + 1)], summary: 'שורה חופפת בין צילומי מסך', action: 'skip' } };
  });
}

/** Saves all selected rows in one database transaction: either everything is saved or nothing is. */
export async function saveImport(cardId: string, rows: ReviewRow[], imageCount: number): Promise<{ added: number; merged: number; skipped: number }> {
  const card = await db.cards.get(cardId);
  if (!card) throw new Error('כרטיס לא נמצא');
  const selected = rows.filter((r) => r.include);
  const invalid = selected.filter((r) => !rowIsValid(r));
  if (invalid.length) throw new Error(`יש ${invalid.length} שורות עם שדות חסרים`);
  const batchId = uid();
  const now = nowIso();
  const today = todayLocal();
  let added = 0;
  let merged = 0;
  let skipped = 0;

  await db.transaction('rw', [db.transactions, db.loanOverrides, db.importBatches, db.merchantRules], async () => {
    for (const r of selected) {
      const amount = r.amountAgorot as number;
      const chargeDate = r.chargeDate as string;
      if (r.loanMatch?.action === 'merge') {
        const existing = await db.loanOverrides.where('[loanId+chargeDate]').equals([r.loanMatch.loanId, r.loanMatch.occurrenceDate]).first();
        const patch = { actualDate: chargeDate, amountAgorot: amount, confirmed: true, excluded: false, note: 'אוחד מייבוא אשראי' };
        if (existing) await db.loanOverrides.update(existing.id, patch);
        else await db.loanOverrides.add({ id: uid(), loanId: r.loanMatch.loanId, chargeDate: r.loanMatch.occurrenceDate, ...patch });
        merged++;
        continue;
      }
      if (r.duplicate?.action === 'skip') {
        skipped++;
        continue;
      }
      if (r.duplicate?.action === 'merge') {
        const t = await db.transactions.get(r.duplicate.existingId);
        if (t) {
          // Keep the user's own edits (merchant name, category); take the confirmed amount/date from the statement.
          await db.transactions.update(t.id, {
            status: 'confirmed',
            amountAgorot: amount,
            chargeDate: r.chargeDateSource === 'explicit' ? chargeDate : t.chargeDate,
            chargeDateSource: r.chargeDateSource === 'explicit' ? 'explicit' : t.chargeDateSource,
            categoryId: t.categoryId ?? r.categoryId,
            importBatchId: batchId,
            updatedAt: now,
          });
          merged++;
          continue;
        }
      }
      const isInstallment = !!(r.installmentIndex && r.installmentCount);
      const groupId = isInstallment ? uid() : undefined;
      await db.transactions.add({
        id: uid(), sourceType: 'card', cardId, merchant: r.merchant.trim(), transactionDate: r.transactionDate as string,
        amountAgorot: amount, categoryId: r.categoryId, chargeDate, chargeDateSource: r.chargeDateSource,
        status: 'confirmed', installmentGroupId: groupId, installmentIndex: r.installmentIndex, installmentCount: r.installmentCount,
        importBatchId: batchId, createdAt: now, updatedAt: now,
      });
      added++;
      if (isInstallment && r.createFuture) {
        for (const f of futureInstallmentsFrom(r.installmentIndex!, r.installmentCount!, chargeDate, card.billingDay, amount)) {
          await db.transactions.add({
            id: uid(), sourceType: 'card', cardId, merchant: r.merchant.trim(), transactionDate: r.transactionDate as string,
            amountAgorot: f.amountAgorot, categoryId: r.categoryId, chargeDate: f.chargeDate, chargeDateSource: 'predicted',
            status: f.chargeDate <= today ? 'confirmed' : 'predicted', installmentGroupId: groupId, installmentIndex: f.index,
            installmentCount: r.installmentCount, importBatchId: batchId, createdAt: now, updatedAt: now,
          });
        }
      }
      if (r.categoryTouched) await rememberMerchantCategory(r.merchant, r.categoryId);
    }
    await db.importBatches.add({ id: batchId, createdAt: now, sourceCardId: cardId, imageCount, importedCount: added + merged });
  });
  return { added, merged, skipped };
}
