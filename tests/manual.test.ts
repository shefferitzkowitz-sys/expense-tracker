import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { createTransaction, deleteTransaction } from '../src/services/transactions';

describe('bank / cash expenses', () => {
  it('a one-off bank transfer is charged on its own date with no card', async () => {
    const [id] = await createTransaction({ sourceType: 'manual', paymentMethod: 'transfer', merchant: 'שכר דירה', transactionDate: '2026-11-03', amountAgorot: 450000 });
    const t = await db.transactions.get(id);
    expect(t).toMatchObject({ chargeDate: '2026-11-03', cardId: undefined, paymentMethod: 'transfer', status: 'confirmed' });
  });
  it('a standing order repeats monthly; deleting from a month removes only that month and later', async () => {
    const ids = await createTransaction({ sourceType: 'manual', paymentMethod: 'debit', merchant: 'ארנונה', transactionDate: '2026-10-31', amountAgorot: 60000, repeatMonths: 4 });
    const rows = (await db.transactions.bulkGet(ids)).map((t) => [t!.chargeDate, t!.amountAgorot]);
    expect(rows).toEqual([['2026-10-31', 60000], ['2026-11-30', 60000], ['2026-12-31', 60000], ['2027-01-31', 60000]]);
    await deleteTransaction(ids[2], true);
    expect((await db.transactions.bulkGet(ids)).map((t) => !!t)).toEqual([true, true, false, false]);
  });
});
