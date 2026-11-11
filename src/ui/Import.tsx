import { useEffect, useMemo, useRef, useState } from 'react';
import { predictChargeDate } from '../lib/billing';
import { isValidDate } from '../lib/dates';
import { parseStatement } from '../lib/ocrParser';
import { readTableFromFile, SheetError } from '../lib/sheet';
import { parseStatementTables } from '../lib/statementTable';

const SHEET_EXT = /\.(xlsx|xls|csv|txt)$/i;
import { formatILS } from '../lib/money';
import { annotateDuplicates, draftsToRows, rowIsValid, saveImport, type ReviewRow } from '../services/importer';
import { recognizeImage } from '../services/ocr';
import { AmountInput, CategorySelect, Empty, Field, IntInput } from './common';
import type { AppData } from './useData';

interface Img {
  id: string;
  kind: 'image' | 'sheet';
  file: File;
  url: string; // object URL for images; empty for spreadsheets
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number;
  message?: string;
}

type Stage = 'pick' | 'ocr' | 'review' | 'done';

export function Import({ data, goSettings }: { data: AppData; goSettings: () => void }) {
  const cards = data.cards.filter((c) => c.active);
  const [cardId, setCardId] = useState(cards[0]?.id ?? '');
  const [images, setImages] = useState<Img[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [stage, setStage] = useState<Stage>('pick');
  const [result, setResult] = useState<{ added: number; merged: number; skipped: number } | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cardId && cards[0]) setCardId(cards[0].id);
  }, [cards, cardId]);

  // Source images live only in memory and are released after import (privacy default).
  const imagesRef = useRef<Img[]>([]);
  imagesRef.current = images;
  useEffect(() => () => imagesRef.current.forEach((i) => i.url && URL.revokeObjectURL(i.url)), []);

  const card = data.cards.find((c) => c.id === cardId);

  const pick = (files: FileList | null) => {
    if (!files) return;
    const list = [...files].filter((f) => f.type.startsWith('image/') || SHEET_EXT.test(f.name));
    setImages((prev) => [
      ...prev,
      ...list.map((file) => {
        const kind = file.type.startsWith('image/') ? ('image' as const) : ('sheet' as const);
        return { id: crypto.randomUUID(), kind, file, url: kind === 'image' ? URL.createObjectURL(file) : '', status: 'pending' as const, progress: 0 };
      }),
    ]);
  };

  const runOcr = async () => {
    setError('');
    setStage('ocr');
    const all: ReviewRow[] = [];
    for (let i = 0; i < images.length; i++) {
      setImages((prev) => prev.map((im, j) => (j === i ? { ...im, status: 'running', progress: 0 } : im)));
      const isSheet = images[i].kind === 'sheet';
      try {
        let drafts;
        if (isSheet) {
          const parsed = parseStatementTables(await readTableFromFile(images[i].file));
          drafts = parsed.drafts;
          if (!parsed.foundHeader) throw new SheetError('לא נמצאה בקובץ טבלת עסקאות עם כותרות כמו "תאריך עסקה", "שם בית עסק" ו"סכום חיוב".');
        } else {
          const lines = await recognizeImage(images[i].file, (p) => setImages((prev) => prev.map((im, j) => (j === i ? { ...im, progress: p } : im))));
          drafts = parseStatement(lines).drafts;
        }
        const r = await draftsToRows(drafts, i, cardId);
        all.push(...r);
        const none = isSheet ? 'לא נמצאו עסקאות בקובץ. אפשר להוסיף שורות ידנית.' : 'לא זוהו עסקאות בתמונה. אפשר להוסיף שורות ידנית.';
        setImages((prev) => prev.map((im, j) => (j === i ? { ...im, status: 'done', progress: 1, message: drafts.length ? `${drafts.length} שורות ${isSheet ? 'נקראו' : 'זוהו'}` : none } : im)));
      } catch (e) {
        console.error(e);
        const msg = e instanceof SheetError ? e.message : isSheet ? 'לא הצלחנו לקרוא את הקובץ. אפשר להוסיף שורות ידנית.' : 'לא הצלחנו לקרוא את התמונה. אפשר להוסיף שורות ידנית.';
        setImages((prev) => prev.map((im, j) => (j === i ? { ...im, status: 'error', message: msg } : im)));
      }
    }
    setRows(await annotateDuplicates(all, cardId));
    setStage('review');
  };

  const update = (key: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r) => {
      if (r.key !== key) return r;
      const next = { ...r, ...patch };
      if ('transactionDate' in patch && next.chargeDateSource === 'predicted' && card && isValidDate(next.transactionDate)) next.chargeDate = predictChargeDate(next.transactionDate, card.billingDay);
      if (patch.chargeDate !== undefined && !('transactionDate' in patch)) next.chargeDateSource = 'manual';
      return next;
    }));
  };

  const addRow = (imageIndex: number) => {
    setRows((prev) => [...prev, { key: `m-${crypto.randomUUID()}`, imageIndex, include: true, transactionDate: '', merchant: '', amountAgorot: null, chargeDate: '', chargeDateSource: 'predicted', createFuture: false, uncertain: [], rawText: '' }]);
  };

  const recheck = async () => setRows(await annotateDuplicates(rows, cardId));

  const selected = rows.filter((r) => r.include);
  const invalidCount = selected.filter((r) => !rowIsValid(r)).length;
  const dupCount = rows.filter((r) => r.duplicate || r.loanMatch).length;
  const selectedTotal = selected.reduce((s, r) => s + (r.amountAgorot ?? 0), 0);

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const res = await saveImport(cardId, rows, images.length);
      images.forEach((i) => i.url && URL.revokeObjectURL(i.url));
      setImages([]);
      setRows([]);
      setResult(res);
      setStage('done');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    images.forEach((i) => i.url && URL.revokeObjectURL(i.url));
    setImages([]);
    setRows([]);
    setResult(null);
    setStage('pick');
  };

  const byImage = useMemo(() => images.map((_, i) => rows.filter((r) => r.imageIndex === i)), [images, rows]);

  if (cards.length === 0) {
    return (
      <div className="page">
        <Empty title="אין עדיין כרטיס אשראי">
          כדי לחשב מועדי חיוב צריך להגדיר כרטיס ויום חיוב.
          <div><button className="btn primary" onClick={goSettings}>להגדרת כרטיס</button></div>
        </Empty>
      </div>
    );
  }

  if (stage === 'done' && result) {
    return (
      <div className="page">
        <section className="card">
          <h3>הייבוא נשמר</h3>
          <p>{result.added} עסקאות נוספו, {result.merged} אוחדו עם חיובים קיימים, {result.skipped} דולגו ככפולות.</p>
          <p className="hint">צילומי המסך לא נשמרו באפליקציה.</p>
          <button className="btn primary" onClick={reset}>ייבוא נוסף</button>
        </section>
      </div>
    );
  }

  return (
    <div className="page import">
      {stage !== 'review' && (
        <section className="card">
          <h3>ייבוא צילומי מסך או קובץ אקסל</h3>
          <p className="hint">אפשר לבחור צילומי מסך מאפליקציית האשראי או קובץ אקסל/CSV שהורדת מאתר חברת האשראי. הקריאה מתבצעת במכשיר בלבד, ושום דבר לא נשלח לשום מקום.</p>
          <Field label="כרטיס מקור" htmlFor="imp-card">
            <select id="imp-card" value={cardId} onChange={(e) => setCardId(e.target.value)} disabled={stage === 'ocr'}>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name} (חיוב ב-{c.billingDay})</option>)}
            </select>
          </Field>
          <input ref={fileRef} type="file" accept="image/*,.xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
          <div className="row-actions">
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={stage === 'ocr'}>בחירת קבצים</button>
            {images.length > 0 && stage === 'pick' && <button className="btn primary" onClick={runOcr}>קריאת {images.length} קבצים</button>}
          </div>
          {images.length > 0 && (
            <ul className="thumbs">
              {images.map((im, i) => (
                <li key={im.id}>
                  {im.kind === 'image' ? <img src={im.url} alt={`צילום ${i + 1}`} /> : <div className="sheet-thumb" title={im.file.name}><span>XLS</span><small>{im.file.name}</small></div>}
                  <div className="thumb-status">
                    {im.status === 'pending' && stage === 'pick' && <button className="link" onClick={() => setImages((p) => p.filter((_, j) => j !== i))}>הסרה</button>}
                    {im.status === 'running' && <progress value={im.progress} max={1} />}
                    {im.message && <span className={im.status === 'error' ? 'err' : ''}>{im.message}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {stage === 'ocr' && <p className="hint">מזהה טקסט… בפעם הראשונה הטעינה איטית יותר.</p>}
        </section>
      )}

      {stage === 'review' && (
        <>
          <section className="card sticky-summary">
            <div className="list-summary">
              <span>{selected.length} שורות נבחרו · {formatILS(selectedTotal)}</span>
              {dupCount > 0 && <span className="badge warn">{dupCount} התאמות לבדיקה</span>}
            </div>
            {invalidCount > 0 && <div className="alert warn">יש {invalidCount} שורות עם שדות חסרים. יש להשלים או לבטל את סימונן.</div>}
            {error && <div className="alert error">{error}</div>}
            <div className="row-actions">
              <button className="btn primary" onClick={save} disabled={saving || invalidCount > 0 || selected.length === 0}>אישור ושמירה</button>
              <button className="btn" onClick={recheck}>בדיקת כפילויות מחדש</button>
              <button className="btn ghost" onClick={reset}>ביטול</button>
            </div>
          </section>

          {images.map((im, i) => (
            <section className="card review-group" key={im.id}>
              <div className="review-head">
                {im.kind === 'image'
                  ? <button className="review-thumb" onClick={() => setZoom(i)} aria-label={`הגדלת צילום ${i + 1}`}><img src={im.url} alt="" /></button>
                  : <div className="review-thumb sheet-thumb"><span>XLS</span></div>}
                <div>
                  <strong>{im.kind === 'image' ? `צילום ${i + 1}` : im.file.name}</strong>
                  <div className={`hint ${im.status === 'error' ? 'err' : ''}`}>{im.message}</div>
                </div>
              </div>
              {byImage[i].map((r) => <ReviewRowEditor key={r.key} row={r} data={data} onChange={(p) => update(r.key, p)} onRemove={() => setRows((prev) => prev.filter((x) => x.key !== r.key))} />)}
              <button className="btn ghost" onClick={() => addRow(i)}>+ הוספת שורה</button>
            </section>
          ))}
        </>
      )}

      {zoom != null && images[zoom] && (
        <div className="zoom" onClick={() => setZoom(null)} role="dialog" aria-label="תצוגת צילום">
          <img src={images[zoom].url} alt={`צילום ${zoom + 1}`} />
        </div>
      )}
    </div>
  );
}

function ReviewRowEditor({ row, data, onChange, onRemove }: { row: ReviewRow; data: AppData; onChange: (p: Partial<ReviewRow>) => void; onRemove: () => void }) {
  const flag = (f: string) => row.uncertain.includes(f) || row.uncertain.includes('all');
  const missing = (v: unknown) => row.include && (v === '' || v == null);
  return (
    <div className={`review-row ${row.include ? '' : 'off'}`}>
      <div className="review-row-top">
        <label className="check"><input type="checkbox" checked={row.include} onChange={(e) => onChange({ include: e.target.checked })} /> לשמור</label>
        {row.uncertain.length > 0 && <span className="badge warn">לבדיקה</span>}
        <button className="link danger" onClick={onRemove}>מחיקה</button>
      </div>
      {row.duplicate && (
        <div className="alert warn">
          כפילות אפשרית: {row.duplicate.summary} ({row.duplicate.reasons.join(', ')})
          <select value={row.duplicate.action} onChange={(e) => onChange({ duplicate: { ...row.duplicate!, action: e.target.value as 'skip' | 'merge' | 'keep' } })} aria-label="פעולה לכפילות">
            <option value="skip">לדלג (כבר קיים)</option>
            {row.duplicate.existingId && <option value="merge">לאחד עם הקיים</option>}
            <option value="keep">לשמור כעסקה נפרדת</option>
          </select>
        </div>
      )}
      {row.loanMatch && (
        <div className="alert info">
          נראה כמו החזר של "{row.loanMatch.loanName}".
          <select value={row.loanMatch.action} onChange={(e) => onChange({ loanMatch: { ...row.loanMatch!, action: e.target.value as 'merge' | 'keep' } })} aria-label="פעולה להחזר הלוואה">
            <option value="merge">לאחד עם ההחזר (בלי ספירה כפולה)</option>
            <option value="keep">לשמור כעסקה נפרדת</option>
          </select>
        </div>
      )}
      <div className="grid2">
        <Field label="תאריך עסקה">
          <input type="date" className={flag('transactionDate') || missing(row.transactionDate) ? 'invalid' : ''} value={row.transactionDate} onChange={(e) => onChange({ transactionDate: e.target.value })} />
        </Field>
        <Field label="סכום">
          <AmountInput value={row.amountAgorot} invalid={flag('amountAgorot') || missing(row.amountAgorot)} onChange={(a) => onChange({ amountAgorot: a })} />
        </Field>
      </div>
      <Field label="בית עסק">
        <input className={flag('merchant') || (row.include && !row.merchant.trim()) ? 'invalid' : ''} value={row.merchant} onChange={(e) => onChange({ merchant: e.target.value })} />
      </Field>
      <div className="grid2">
        <Field label="קטגוריה">
          <CategorySelect categories={data.categories} value={row.categoryId} onChange={(v) => onChange({ categoryId: v, categoryTouched: true })} />
        </Field>
        <Field label={`מועד חיוב${row.chargeDateSource === 'explicit' ? ' (מהצילום)' : row.chargeDateSource === 'predicted' ? ' (מחושב)' : ''}`}>
          <input type="date" className={missing(row.chargeDate) ? 'invalid' : ''} value={row.chargeDate} onChange={(e) => onChange({ chargeDate: e.target.value })} />
        </Field>
      </div>
      <div className="grid2">
        <Field label="תשלום מספר">
          <IntInput value={row.installmentIndex} max={36} onChange={(n) => onChange({ installmentIndex: n || undefined })} />
        </Field>
        <Field label="מתוך">
          <IntInput value={row.installmentCount} max={36} onChange={(n) => onChange({ installmentCount: n || undefined })} />
        </Field>
      </div>
      {row.installmentIndex && row.installmentCount && row.installmentIndex < row.installmentCount && (
        <label className="check"><input type="checkbox" checked={row.createFuture} onChange={(e) => onChange({ createFuture: e.target.checked })} /> ליצור את {row.installmentCount - row.installmentIndex} התשלומים הבאים כתחזית</label>
      )}
      {row.rawText && <div className="raw" dir="auto">{row.rawText}</div>}
    </div>
  );
}
