import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ExpenseDB, ensureSeed } from '../src/db';
import { exportBackup, readBackup, restoreReplace } from '../src/services/backup';
import { chargeLines, summarizeMonth } from '../src/lib/analytics';

async function totals(d: ExpenseDB) {
  const lines = chargeLines(await d.transactions.toArray(), await d.loans.toArray(), await d.loanOverrides.toArray(), '2026-11', '2026-11', '2026-11-11');
  return summarizeMonth(lines, '2026-11', '2026-11-11').total;
}

describe('backup and restore (spec §12, §14)', () => {
  it('export, wipe, restore returns the same totals; encrypted file needs the password', async () => {
    const d = new ExpenseDB('t-' + Math.random());
    await ensureSeed(d);
    await d.cards.add({ id: 'C1', name: 'ויזה', billingDay: 10, active: true, createdAt: '' });
    await d.transactions.add({ id: 'T1', sourceType: 'card', cardId: 'C1', merchant: 'סופר', transactionDate: '2026-11-01', amountAgorot: 12345, chargeDate: '2026-11-10', chargeDateSource: 'predicted', status: 'confirmed', createdAt: '', updatedAt: '' });
    await d.loans.add({ id: 'L1', name: 'רכב', monthlyAmountAgorot: 150000, billingDay: 2, startDate: '2026-01-01', active: true });
    const before = await totals(d);

    const file = await exportBackup('סיסמה-חזקה', d);
    expect(file).not.toContain('סופר');
    await expect(readBackup(file, 'wrong')).rejects.toThrow('סיסמה שגויה');
    const parsed = await readBackup(file, 'סיסמה-חזקה');

    await Promise.all(d.tables.map((t) => t.clear()));
    expect(await totals(d)).toBe(0);
    await restoreReplace(parsed, d);
    expect(await totals(d)).toBe(before);
  });

  it('a broken backup is rejected before anything is deleted', async () => {
    const bad = JSON.stringify({ app: 'expense-tracker-pwa', schemaVersion: 1, data: { cards: [] } });
    await expect(readBackup(bad)).rejects.toThrow();
  });
});
