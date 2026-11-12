import { useMemo, useState } from 'react';
import { chargeLines, summarizeMonth } from '../lib/analytics';
import { budgetRange, formatDate, monthLabel, type MonthKey } from '../lib/dates';
import { PAYMENT_METHODS, UNCATEGORIZED, type ChargeLine } from '../lib/types';
import { Bars, categoryName, Empty, Money, MonthPicker, Sheet, sourceName, StatusBadge } from './common';
import type { AppData } from './useData';

export function LinesList({ lines, data, onOpen }: { lines: ChargeLine[]; data: AppData; onOpen?: (l: ChargeLine) => void }) {
  if (lines.length === 0) return <Empty title="אין חיובים" />;
  return (
    <ul className="tx-list">
      {lines.map((l) => {
        const t = l.kind === 'transaction' ? data.transactions.find((x) => x.id === l.refId) : undefined;
        return (
          <li key={l.key}>
            <button className={`tx-row ${l.status}`} onClick={() => onOpen?.(l)} disabled={!onOpen}>
              <div className="tx-main">
                <span className="tx-merchant">{l.merchant || 'ללא תיאור'}</span>
                <span className="tx-meta">
                  {l.kind === 'loan' ? 'הלוואה' : l.sourceType === 'manual' && l.paymentMethod ? PAYMENT_METHODS[l.paymentMethod] : sourceName(data.cards, l.sourceType === 'manual' ? 'manual' : l.cardId ?? 'manual')}
                  {' · '}חיוב {formatDate(l.chargeDate)}
                  {t?.installmentIndex ? ` · תשלום ${t.installmentIndex}/${t.installmentCount}` : ''}
                  {' · '}{categoryName(data.categories, l.categoryId)}
                </span>
              </div>
              <div className="tx-side">
                <Money a={l.amountAgorot} />
                <StatusBadge status={l.status} />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function Dashboard({ data, month, setMonth, onOpenLine, onNew }: { data: AppData; month: MonthKey; setMonth: (m: MonthKey) => void; onOpenLine: (l: ChargeLine) => void; onNew: () => void }) {
  const lines = useMemo(() => chargeLines(data.transactions, data.loans, data.overrides, month, month), [data, month]);
  const s = useMemo(() => summarizeMonth(lines, month), [lines, month]);
  const [drill, setDrill] = useState<{ title: string; filter: (l: ChargeLine) => boolean } | null>(null);

  const cats = [...s.byCategory.entries()]
    .map(([key, value]) => ({ key, label: categoryName(data.categories, key), value, muted: key === UNCATEGORIZED }))
    .sort((a, b) => (a.key === UNCATEGORIZED ? 1 : b.key === UNCATEGORIZED ? -1 : b.value - a.value));
  const sources = [...s.bySource.entries()].map(([key, value]) => ({ key, label: sourceName(data.cards, key), value })).sort((a, b) => b.value - a.value);

  const counted = (l: ChargeLine) => l.status !== 'excluded';

  return (
    <div className="page">
      <MonthPicker month={month} onChange={setMonth} />

      <section className="card hero">
        <div className="hero-top">
          <span className="muted">סך חיובים ב{monthLabel(month)}</span>
          {s.isPartialForecast && <span className="badge predicted">{s.isFuture ? 'תחזית חלקית' : 'חודש פתוח'}</span>}
        </div>
        <Money a={s.total} className="hero-amount" />
        <span className="muted small">הוצאות מ-{formatDate(budgetRange(month)[0])} עד {formatDate(budgetRange(month)[1])}</span>
        <div className="split">
          <button className="split-item" onClick={() => setDrill({ title: 'אשראי והוצאות', filter: (l) => counted(l) && l.kind === 'transaction' })}>
            <span className="muted">אשראי והוצאות</span>
            <Money a={s.cardAndManual} round />
          </button>
          <button className="split-item" onClick={() => setDrill({ title: 'הלוואות', filter: (l) => counted(l) && l.kind === 'loan' })}>
            <span className="muted">הלוואות</span>
            <Money a={s.loans} round />
          </button>
        </div>
        {s.predicted > 0 && (
          <div className="hint">
            מתוכם <Money a={s.predicted} round /> חזוי (תשלומים עתידיים והחזרי הלוואות שטרם חויבו)
          </div>
        )}
      </section>

      <section className="card">
        <h3>לפי קטגוריה</h3>
        {cats.length ? (
          <Bars items={cats} onSelect={(key) => setDrill({ title: categoryName(data.categories, key), filter: (l) => counted(l) && (l.categoryId ?? UNCATEGORIZED) === key })} />
        ) : (
          <Empty title="אין חיובים בחודש הזה">אפשר להוסיף עסקה או לייבא צילומי מסך</Empty>
        )}
      </section>

      {sources.length > 0 && (
        <section className="card">
          <h3>לפי מקור</h3>
          <Bars
            items={sources}
            onSelect={(key) => setDrill({ title: sourceName(data.cards, key), filter: (l) => counted(l) && (key === 'loan' ? l.kind === 'loan' : key === 'manual' ? l.sourceType === 'manual' : l.cardId === key) })}
          />
        </section>
      )}

      {drill && (
        <Sheet title={`${drill.title} · ${monthLabel(month)}`} onClose={() => setDrill(null)}>
          <LinesList lines={lines.filter(drill.filter)} data={data} onOpen={(l) => { setDrill(null); onOpenLine(l); }} />
        </Sheet>
      )}
      <button className="fab" onClick={onNew} aria-label="הוצאה חדשה">+</button>
    </div>
  );
}
