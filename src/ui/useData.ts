import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { setCycleStartDay } from '../lib/dates';
import type { Card, Category, Loan, LoanOverride, MerchantRule, Transaction } from '../lib/types';

export interface AppData {
  ready: boolean;
  cards: Card[];
  categories: Category[];
  transactions: Transaction[];
  loans: Loan[];
  overrides: LoanOverride[];
  rules: MerchantRule[];
  cycleStartDay: number;
}

export function useData(): AppData {
  const r = useLiveQuery(async () => {
    const [cards, categories, transactions, loans, overrides, rules] = await Promise.all([
      db.cards.toArray(),
      db.categories.orderBy('sortOrder').toArray(),
      db.transactions.toArray(),
      db.loans.toArray(),
      db.loanOverrides.toArray(),
      db.merchantRules.toArray(),
    ]);
    const setting = await db.settings.get('cycleStartDay');
    const cycleStartDay = typeof setting?.value === 'number' ? setting.value : 10;
    setCycleStartDay(cycleStartDay);
    return { cards, categories, transactions, loans, overrides, rules, cycleStartDay };
  }, []);
  return r ? { ready: true, ...r } : { ready: false, cards: [], categories: [], transactions: [], loans: [], overrides: [], rules: [], cycleStartDay: 10 };
}
