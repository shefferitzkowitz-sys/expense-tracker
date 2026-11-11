import { useEffect, useState, type ReactNode } from 'react';
import { addMonths, monthLabel, type MonthKey } from '../lib/dates';
import { agorotToInput, formatILS, parseAmount } from '../lib/money';
import { UNCATEGORIZED, type Card, type Category } from '../lib/types';

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function MonthPicker({ month, onChange }: { month: MonthKey; onChange: (m: MonthKey) => void }) {
  return (
    <div className="month-picker">
      <button className="icon-btn" onClick={() => onChange(addMonths(month, -1))} aria-label="חודש קודם">›</button>
      <label className="month-label">
        <span>{monthLabel(month)}</span>
        <input type="month" value={month} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="בחירת חודש" />
      </label>
      <button className="icon-btn" onClick={() => onChange(addMonths(month, 1))} aria-label="חודש הבא">‹</button>
    </div>
  );
}

export function AmountInput({ value, onChange, id, invalid }: { value: number | null; onChange: (a: number | null) => void; id?: string; invalid?: boolean }) {
  const [text, setText] = useState(value == null ? '' : agorotToInput(value));
  useEffect(() => {
    const parsed = parseAmount(text);
    if (parsed !== value) setText(value == null ? '' : agorotToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className={invalid ? 'invalid' : undefined}
      inputMode="decimal"
      dir="ltr"
      placeholder="0.00"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? null : parseAmount(e.target.value));
      }}
    />
  );
}

export function CategorySelect({ categories, value, onChange, id, allowEmptyLabel = 'לא מסווג' }: { categories: Category[]; value?: string; onChange: (id?: string) => void; id?: string; allowEmptyLabel?: string }) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{allowEmptyLabel}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}

export function categoryName(categories: Category[], id?: string): string {
  if (!id || id === UNCATEGORIZED) return 'לא מסווג';
  return categories.find((c) => c.id === id)?.name ?? 'לא מסווג';
}

export function sourceName(cards: Card[], key: string): string {
  if (key === 'loan') return 'הלוואות';
  if (key === 'manual') return 'הוצאות ידניות';
  return cards.find((c) => c.id === key)?.name ?? 'כרטיס';
}

export function Money({ a, round, className }: { a: number; round?: boolean; className?: string }) {
  return <span className={`money ${className ?? ''}`} dir="ltr">{formatILS(a, round)}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: 'predicted' | 'confirmed' | 'excluded' }) {
  if (status === 'confirmed') return null;
  return <span className={`badge ${status}`}>{status === 'predicted' ? 'חזוי' : 'לא נספר'}</span>;
}

/** Simple horizontal bars, values in agorot. */
export function Bars({ items, onSelect }: { items: { key: string; label: string; value: number; muted?: boolean }[]; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="bars">
      {items.map((i) => (
        <li key={i.key}>
          <button className="bar-row" onClick={() => onSelect?.(i.key)} disabled={!onSelect}>
            <span className="bar-label">{i.label}</span>
            <span className="bar-track"><span className={`bar-fill ${i.muted ? 'muted' : ''}`} style={{ width: `${(Math.max(0, i.value) / max) * 100}%` }} /></span>
            <Money a={i.value} round className="bar-value" />
          </button>
        </li>
      ))}
    </ul>
  );
}
