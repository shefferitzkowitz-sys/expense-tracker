import { db, nowIso, uid } from '../db';
import { installmentChargeDate, predictChargeDate } from '../lib/billing';
import { buildInstallments } from '../lib/installments';
import { normalizeMerchant } from '../lib/merchant';
import { addMonths, dayInMonth, monthOf, todayLocal, type ISODate } from '../lib/dates';
import type { ChargeDateSource, PaymentMethod, Transaction } from '../lib/types';

export interface NewTx {
  sourceType: 'card' | 'manual';
  cardId?: string;
  merchant: string;
  transactionDate: ISODate;
  amountAgorot: number;
  categoryId?: string;
  chargeDate?: ISODate; // explicit/manual; otherwise predicted from card or equals transaction date for manual
  installmentCount?: number; // >1 creates a full installment plan, amount = total
  note?: string;
  rememberCategory?: boolean;
  paymentMethod?: PaymentMethod;
  /** Non-card only: >1 creates this many monthly charges of the full amount (a standing order). */
  repeatMonths?: number;
}

export async function billingDayOf(cardId?: string): Promise<number | undefined> {
  if (!cardId) return undefined;
  return (await db.cards.get(cardId))?.billingDay;
}

/** Charge date + source for a new transaction. Manual expenses default to the expense date. */
export function resolveChargeDate(sourceType: 'card' | 'manual', transactionDate: ISODate, billingDay?: number, explicit?: ISODate): { chargeDate: ISODate; source: ChargeDateSource } {
  if (explicit) return { chargeDate: explicit, source: sourceType === 'manual' ? 'manual' : 'explicit' };
  if (sourceType === 'card' && billingDay) return { chargeDate: predictChargeDate(transactionDate, billingDay), source: 'predicted' };
  return { chargeDate: transactionDate, source: 'predicted' };
}

export async function rememberMerchantCategory(merchant: string, categoryId?: string): Promise<void> {
  const n = normalizeMerchant(merchant);
  if (!n || !categoryId) return;
  const existing = await db.merchantRules.where('normalizedMerchant').equals(n).first();
  if (existing) await db.merchantRules.update(existing.id, { categoryId, enabled: true });
  else await db.merchantRules.add({ id: uid(), normalizedMerchant: n, categoryId, enabled: true });
}

export async function createTransaction(input: NewTx): Promise<string[]> {
  const billingDay = await billingDayOf(input.cardId);
  const now = nowIso();
  const today = todayLocal();
  const ids: string[] = [];
  await db.transaction('rw', db.transactions, db.merchantRules, async () => {
    if (input.installmentCount && input.installmentCount > 1) {
      const groupId = uid();
      const plan = buildInstallments({
        transactionDate: input.transactionDate,
        billingDay: billingDay ?? Number(input.transactionDate.slice(8, 10)),
        count: input.installmentCount,
        totalAgorot: input.amountAgorot,
        firstChargeDate: input.chargeDate,
      });
      for (const p of plan) {
        const id = uid();
        ids.push(id);
        await db.transactions.add({
          id, sourceType: input.sourceType, cardId: input.cardId, merchant: input.merchant, transactionDate: input.transactionDate,
          amountAgorot: p.amountAgorot, totalAgorot: input.amountAgorot, categoryId: input.categoryId, chargeDate: p.chargeDate,
          chargeDateSource: input.chargeDate ? 'explicit' : 'predicted', status: p.chargeDate <= today ? 'confirmed' : 'predicted',
          installmentGroupId: groupId, installmentIndex: p.index, installmentCount: input.installmentCount, note: input.note,
          createdAt: now, updatedAt: now,
        });
      }
    } else if (input.sourceType === 'manual' && input.repeatMonths && input.repeatMonths > 1) {
      const groupId = uid();
      const first = input.chargeDate ?? input.transactionDate;
      const day = Number(first.slice(8, 10));
      for (let k = 0; k < input.repeatMonths; k++) {
        const chargeDate = dayInMonth(addMonths(monthOf(first), k), day);
        const id = uid();
        ids.push(id);
        await db.transactions.add({
          id, sourceType: 'manual', paymentMethod: input.paymentMethod, merchant: input.merchant,
          transactionDate: k === 0 ? input.transactionDate : chargeDate, amountAgorot: input.amountAgorot, categoryId: input.categoryId,
          chargeDate, chargeDateSource: 'manual', status: chargeDate <= today ? 'confirmed' : 'predicted',
          recurringGroupId: groupId, note: input.note, createdAt: now, updatedAt: now,
        });
      }
    } else {
      const { chargeDate, source } = resolveChargeDate(input.sourceType, input.transactionDate, billingDay, input.chargeDate);
      const id = uid();
      ids.push(id);
      await db.transactions.add({
        id, sourceType: input.sourceType, cardId: input.cardId, merchant: input.merchant, transactionDate: input.transactionDate,
        amountAgorot: input.amountAgorot, categoryId: input.categoryId, chargeDate, chargeDateSource: source, status: 'confirmed',
        paymentMethod: input.sourceType === 'manual' ? input.paymentMethod : undefined, note: input.note, createdAt: now, updatedAt: now,
      });
    }
    if (input.rememberCategory) await rememberMerchantCategory(input.merchant, input.categoryId);
  });
  return ids;
}

export async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
  await db.transactions.update(id, { ...patch, updatedAt: nowIso() });
}

export async function deleteTransaction(id: string, wholeGroup = false): Promise<void> {
  const t = await db.transactions.get(id);
  if (!t) return;
  if (wholeGroup && t.installmentGroupId) await db.transactions.where('installmentGroupId').equals(t.installmentGroupId).delete();
  else if (wholeGroup && t.recurringGroupId) {
    // Only this charge and the ones after it: past months of a standing order really happened.
    const g = t.recurringGroupId;
    await db.transactions.filter((x) => x.recurringGroupId === g && x.chargeDate >= t.chargeDate).delete();
  } else await db.transactions.delete(id);
}

/** After a card's billing day changes, only predicted charge dates are recalculated; explicit/manual ones stay. */
export async function recomputePredictedChargeDates(cardId: string): Promise<number> {
  const card = await db.cards.get(cardId);
  if (!card) return 0;
  let changed = 0;
  await db.transaction('rw', db.transactions, async () => {
    const txs = await db.transactions.where('cardId').equals(cardId).toArray();
    const groups = new Map<string, Transaction[]>();
    for (const t of txs) {
      if (t.chargeDateSource !== 'predicted') continue;
      if (t.installmentGroupId) {
        const g = groups.get(t.installmentGroupId) ?? [];
        g.push(t);
        groups.set(t.installmentGroupId, g);
        continue;
      }
      const next = predictChargeDate(t.transactionDate, card.billingDay);
      if (next !== t.chargeDate) {
        await db.transactions.update(t.id, { chargeDate: next, updatedAt: nowIso() });
        changed++;
      }
    }
    for (const g of groups.values()) {
      const first = predictChargeDate(g[0].transactionDate, card.billingDay);
      for (const t of g) {
        const next = installmentChargeDate(first, card.billingDay, t.installmentIndex ?? 1);
        if (next !== t.chargeDate) {
          await db.transactions.update(t.id, { chargeDate: next, updatedAt: nowIso() });
          changed++;
        }
      }
    }
  });
  return changed;
}

/** Deletes a category; its transactions and loans move to `replacementId` or become uncategorized. */
export async function deleteCategory(id: string, replacementId?: string): Promise<void> {
  await db.transaction('rw', db.categories, db.transactions, db.loans, db.merchantRules, async () => {
    await db.transactions.where('categoryId').equals(id).modify({ categoryId: replacementId });
    await db.loans.filter((l) => l.categoryId === id).modify({ categoryId: replacementId });
    if (replacementId) await db.merchantRules.filter((r) => r.categoryId === id).modify({ categoryId: replacementId });
    else await db.merchantRules.filter((r) => r.categoryId === id).delete();
    await db.categories.delete(id);
  });
}
