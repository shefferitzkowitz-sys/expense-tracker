import Dexie, { type EntityTable } from 'dexie';
import type { Card, Category, ImportBatch, Loan, LoanOverride, MerchantRule, Setting, Transaction } from './lib/types';

export const SCHEMA_VERSION = 1;

export class ExpenseDB extends Dexie {
  cards!: EntityTable<Card, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  loans!: EntityTable<Loan, 'id'>;
  loanOverrides!: EntityTable<LoanOverride, 'id'>;
  merchantRules!: EntityTable<MerchantRule, 'id'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  settings!: EntityTable<Setting, 'key'>;

  constructor(name = 'expense-tracker') {
    super(name);
    this.version(SCHEMA_VERSION).stores({
      cards: 'id, active',
      categories: 'id, sortOrder',
      transactions: 'id, chargeDate, transactionDate, cardId, categoryId, status, installmentGroupId, importBatchId, sourceType',
      loans: 'id, active',
      loanOverrides: 'id, loanId, [loanId+chargeDate]',
      merchantRules: 'id, &normalizedMerchant',
      importBatches: 'id, createdAt',
      settings: 'key',
    });
  }
}

export const db = new ExpenseDB();

export const uid = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

export const DEFAULT_CATEGORIES = [
  'דיור', 'רכב ותחבורה', 'מזון וסופר', 'מסעדות ובילויים', 'קניות', 'חשבונות ותקשורת',
  'בריאות', 'ביטוחים', 'מנויים', 'חופשות ונסיעות', 'אחר',
];

export async function ensureSeed(d: ExpenseDB = db): Promise<void> {
  await d.transaction('rw', d.categories, d.settings, async () => {
    const seeded = await d.settings.get('seeded');
    if (seeded) return;
    await d.categories.bulkAdd(DEFAULT_CATEGORIES.map((name, i) => ({ id: uid(), name, sortOrder: i, isSystem: true })));
    await d.settings.put({ key: 'seeded', value: true });
    await d.settings.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  });
}
