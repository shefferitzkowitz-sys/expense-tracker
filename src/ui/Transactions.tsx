import { useMemo, useState } from 'react';
import { chargeLines, summarizeMonth } from '../lib/analytics';
import { monthLabel, type MonthKey } from '../lib/dates';
import { normalizeMerchant } from '../lib/merchant';
import { UNCATEGORIZED, type ChargeLine } from '../lib/types';
import { Money, MonthPicker } from './common';
import { LinesList } from './Dashboard';
import type { AppData } from './useData';

export function Transactions({ data, month, setMonth, onOpenLine, onNew }: { data: AppData; month: MonthKey; setMonth: (m: MonthKey) => void; onOpenLine: (l: ChargeLine) => void; onNew: () => void }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [category, setCategory] = useState('all');
  const lines = useMemo(() => chargeLines(data.transactions, data.loans, data.overrides, month, month), [data, month]);
  const filtered = lines.filter((l) => {
    if (source !== 'all' && !(source === 'loan' ? l.kind === 'loan' : source === 'manual' ? l.sourceType === 'manual' : l.cardId === source)) return false;
    if (category !== 'all' && (l.categoryId ?? UNCATEGORIZED) !== category) return false;
    if (q && !normalizeMerchant(l.merchant).includes(normalizeMerchant(q))) return false;
    return true;
  });
  const s = summarizeMonth(filtered, month);

  return (
    <div className="page">
      <MonthPicker month={month} onChange={setMonth} />
      <div className="filters">
        <input type="search" placeholder="חיפוש בית עסק" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש" />
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="מקור">
          <option value="all">כל המקורות</option>
          {data.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="manual">הוצאות ידניות</option>
          <option value="loan">הלוואות</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="קטגוריה">
          <option value="all">כל הקטגוריות</option>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={UNCATEGORIZED}>לא מסווג</option>
        </select>
      </div>
      <div className="list-summary">
        <span>{filtered.length} חיובים לחיוב ב{monthLabel(month)}</span>
        <Money a={s.total} />
      </div>
      <LinesList lines={filtered} data={data} onOpen={onOpenLine} />
      <button className="fab" onClick={onNew} aria-label="עסקה חדשה">+</button>
    </div>
  );
}
