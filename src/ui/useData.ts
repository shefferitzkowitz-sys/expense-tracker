import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Card, Category, Loan, LoanOverride, MerchantRule, Transaction } from '../lib/types';

export interface AppData {
  ready: boolean;
  cards: Card[];
  categories: Category[];
  transactions: Transaction[];
  loans: Loan[];
  overrides: LoanOverride[];
  rules: MerchantRule[];
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
    return { cards, categories, transactions, loans, overrides, rules };
  }, []);
  return r ? { ready: true, ...r } : { ready: false, cards: [], categories: [], transactions: [], loans: [], overrides: [], rules: [] };
}
