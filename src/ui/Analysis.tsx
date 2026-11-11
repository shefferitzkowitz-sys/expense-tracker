import { useMemo, useState } from 'react';
import { chargeLines, summarizeMonth } from '../lib/analytics';
import { addMonths, monthLabel, monthOf, monthsBetween, shortMonthLabel, todayLocal, type MonthKey } from '../lib/dates';
import { formatILS } from '../lib/money';
import { UNCATEGORIZED, type ChargeLine } from '../lib/types';
import { categoryName, Money, sourceName } from './common';
import type { AppData } from './useData';

type SourceFilter = 'all' | 'loan' | 'manual' | string;

export function Analysis({ data }: { data: AppData }) {
  const thisMonth = monthOf(todayLocal());
  const [back, setBack] = useState(6);
  const [source, setSource] = useState<SourceFilter>('all');
  const [category, setCategory] = useState<string>('all');
  const from = addMonths(thisMonth, -(back - 1));
  const to = addMonths(thisMonth, 3);
  const months = monthsBetween(from, to);

  const lines = useMemo(() => {
    const all = chargeLines(data.transactions, data.loans, data.overrides, from, to);
    return all.filter((l: ChargeLine) =>
      (source === 'all' || (source === 'loan' ? l.kind === 'loan' : source === 'manual' ? l.sourceType === 'manual' : l.cardId === source)) &&
      (category === 'all' || (l.categoryId ?? UNCATEGORIZED) === category));
  }, [data, from, to, source, category]);

  const sums = months.map((m) => summarizeMonth(lines, m));
  const max = Math.max(1, ...sums.map((s) => s.total));
  const [cmpA, setCmpA] = useState<MonthKey>(addMonths(thisMonth, -1));
  const [cmpB, setCmpB] = useState<MonthKey>(thisMonth);
  const sA = summarizeMonth(chargeLines(data.transactions, data.loans, data.overrides, cmpA, cmpA), cmpA);
  const sB = summarizeMonth(chargeLines(data.transactions, data.loans, data.overrides, cmpB, cmpB), cmpB);
  const catKeys = [...new Set([...sA.byCategory.keys(), ...sB.byCategory.keys()])];
  const rows = catKeys
    .map((k) => ({ k, a: sA.byCategory.get(k) ?? 0, b: sB.byCategory.get(k) ?? 0 }))
    .sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a));

  const W = 340, H = 180, pad = 22;
  const bw = (W - pad) / months.length;

  return (
    <div className="page">
      <section className="card">
        <h3>מגמה חודשית</h3>
        <div className="filters">
          <select value={back} onChange={(e) => setBack(Number(e.target.value))} aria-label="טווח">
            <option value={3}>3 חודשים אחורה</option>
            <option value={6}>6 חודשים אחורה</option>
            <option value={12}>12 חודשים אחורה</option>
          </select>
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
        <svg viewBox={`0 0 ${W} ${H + 30}`} className="chart" role="img" aria-label="סך חיובים לפי חודש">
          {sums.map((s, i) => {
            const x = W - pad - (i + 1) * bw + 3; // RTL: newest on the left
            const hc = (s.confirmed / max) * H;
            const hp = (s.predicted / max) * H;
            return (
              <g key={s.month}>
                <title>{`${monthLabel(s.month)}: ${formatILS(s.total, true)}${s.predicted ? ` (חזוי ${formatILS(s.predicted, true)})` : ''}`}</title>
                <rect x={x} y={H - hc} width={bw - 6} height={hc} rx="3" className="bar-confirmed" />
                <rect x={x} y={H - hc - hp} width={bw - 6} height={hp} rx="3" className="bar-predicted" />
                <text x={x + (bw - 6) / 2} y={H + 16} textAnchor="middle" className={`axis ${s.month === thisMonth ? 'current' : ''}`}>{shortMonthLabel(s.month)}</text>
              </g>
            );
          })}
          <line x1="0" x2={W} y1={H} y2={H} className="baseline" />
        </svg>
        <div className="legend">
          <span><i className="sw confirmed" /> מאושר</span>
          <span><i className="sw predicted" /> תחזית</span>
        </div>
        <table className="table">
          <thead><tr><th>חודש</th><th>סך</th><th>מתוכו חזוי</th></tr></thead>
          <tbody>
            {[...sums].reverse().map((s) => (
              <tr key={s.month} className={s.isFuture ? 'future' : ''}>
                <td>{monthLabel(s.month)}{s.isFuture ? ' (תחזית חלקית)' : ''}</td>
                <td><Money a={s.total} round /></td>
                <td>{s.predicted ? <Money a={s.predicted} round /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>השוואת חודשים</h3>
        <div className="filters">
          <input type="month" value={cmpA} onChange={(e) => e.target.value && setCmpA(e.target.value)} aria-label="חודש א" />
          <span className="muted">מול</span>
          <input type="month" value={cmpB} onChange={(e) => e.target.value && setCmpB(e.target.value)} aria-label="חודש ב" />
        </div>
        <table className="table">
          <thead><tr><th>קטגוריה</th><th>{shortMonthLabel(cmpA)}</th><th>{shortMonthLabel(cmpB)}</th><th>שינוי</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <td>{categoryName(data.categories, r.k)}</td>
                <td><Money a={r.a} round /></td>
                <td><Money a={r.b} round /></td>
                <td className={r.b > r.a ? 'up' : r.b < r.a ? 'down' : ''}><Money a={r.b - r.a} round /></td>
              </tr>
            ))}
            <tr className="total-row">
              <td>סה״כ</td><td><Money a={sA.total} round /></td><td><Money a={sB.total} round /></td>
              <td className={sB.total > sA.total ? 'up' : 'down'}><Money a={sB.total - sA.total} round /></td>
            </tr>
          </tbody>
        </table>
        <div className="hint">לפי מקור ב{monthLabel(cmpB)}: {[...sB.bySource.entries()].map(([k, v]) => `${sourceName(data.cards, k)} ${formatILS(v, true)}`).join(' · ') || '—'}</div>
      </section>
    </div>
  );
}
