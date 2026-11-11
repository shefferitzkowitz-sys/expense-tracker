import { useEffect, useState } from 'react';
import { db, nowIso, uid } from '../db';
import { formatDate, isValidDate, todayLocal } from '../lib/dates';
import { loanLastMonth, loanOccurrences } from '../lib/loans';
import { formatILS } from '../lib/money';
import { addMonths, monthOf } from '../lib/dates';
import type { Card, Category, Loan } from '../lib/types';
import { backupCounts, exportBackup, isEncryptedBackup, readBackup, restoreReplace, saveBackupFile, type PlainBackup } from '../services/backup';
import { deleteCategory, recomputePredictedChargeDates } from '../services/transactions';
import { AmountInput, categoryName, CategorySelect, Field, IntInput, Money, Sheet } from './common';
import type { AppData } from './useData';

export function Settings({ data }: { data: AppData }) {
  const [editCard, setEditCard] = useState<Card | 'new' | null>(null);
  const [editLoan, setEditLoan] = useState<Loan | 'new' | null>(null);
  const [editCat, setEditCat] = useState<Category | 'new' | null>(null);
  return (
    <div className="page">
      <section className="card">
        <div className="section-head"><h3>כרטיסי אשראי</h3><button className="btn small" onClick={() => setEditCard('new')}>+ כרטיס</button></div>
        {data.cards.length === 0 && <p className="hint">הוסף כרטיס עם יום החיוב החודשי שלו.</p>}
        <ul className="plain-list">
          {data.cards.map((c) => (
            <li key={c.id}><button className="list-btn" onClick={() => setEditCard(c)}><span>{c.name}{!c.active && ' (לא פעיל)'}</span><span className="muted">חיוב ב-{c.billingDay} לחודש</span></button></li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="section-head"><h3>הלוואות</h3><button className="btn small" onClick={() => setEditLoan('new')}>+ הלוואה</button></div>
        <ul className="plain-list">
          {data.loans.map((l) => (
            <li key={l.id}><button className="list-btn" onClick={() => setEditLoan(l)}><span>{l.name}{!l.active && ' (לא פעילה)'}</span><span className="muted"><Money a={l.monthlyAmountAgorot} round /> ב-{l.billingDay} לחודש</span></button></li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="section-head"><h3>קטגוריות</h3><button className="btn small" onClick={() => setEditCat('new')}>+ קטגוריה</button></div>
        <ul className="plain-list">
          {data.categories.map((c) => (
            <li key={c.id}><button className="list-btn" onClick={() => setEditCat(c)}><span>{c.name}</span><span className="muted">{data.transactions.filter((t) => t.categoryId === c.id).length} עסקאות</span></button></li>
          ))}
          <li><div className="list-btn static"><span>לא מסווג</span><span className="muted">קבוצת מערכת</span></div></li>
        </ul>
      </section>

      <RulesSection data={data} />
      <BackupSection />
      <StorageSection />

      {editCard && <CardForm card={editCard === 'new' ? undefined : editCard} onClose={() => setEditCard(null)} />}
      {editLoan && <LoanForm data={data} loan={editLoan === 'new' ? undefined : editLoan} onClose={() => setEditLoan(null)} />}
      {editCat && <CategoryForm data={data} category={editCat === 'new' ? undefined : editCat} onClose={() => setEditCat(null)} />}
    </div>
  );
}

function CardForm({ card, onClose }: { card?: Card; onClose: () => void }) {
  const [name, setName] = useState(card?.name ?? '');
  const [day, setDay] = useState<number | null>(card?.billingDay ?? 10);
  const [active, setActive] = useState(card?.active ?? true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const save = async () => {
    if (!name.trim()) return setError('חסר כינוי לכרטיס');
    if (day == null || !(day >= 1 && day <= 31)) return setError('יום חיוב בין 1 ל-31');
    if (card) {
      await db.cards.update(card.id, { name: name.trim(), billingDay: day, active });
      if (day !== card.billingDay) {
        const n = await recomputePredictedChargeDates(card.id);
        setMsg(`עודכנו ${n} מועדי חיוב מחושבים. מועדים שהוזנו ידנית או מהצילום לא השתנו.`);
        return;
      }
    } else {
      await db.cards.add({ id: uid(), name: name.trim(), billingDay: day, active, createdAt: nowIso() });
    }
    onClose();
  };
  const remove = async () => {
    const used = await db.transactions.where('cardId').equals(card!.id).count();
    if (used) return setError(`לכרטיס יש ${used} עסקאות. אפשר לסמן אותו כלא פעיל.`);
    await db.cards.delete(card!.id);
    onClose();
  };
  return (
    <Sheet title={card ? 'עריכת כרטיס' : 'כרטיס חדש'} onClose={onClose} footer={msg ? <button className="btn primary" onClick={onClose}>סגירה</button> : <><button className="btn primary" onClick={save}>שמירה</button>{card && <button className="btn danger ghost" onClick={remove}>מחיקה</button>}</>}>
      {error && <div className="alert error">{error}</div>}
      {msg && <div className="alert info">{msg}</div>}
      <Field label="כינוי" htmlFor="c-name"><input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: ויזה כאל" /></Field>
      <Field label="יום חיוב בחודש" htmlFor="c-day" hint={day != null && day > 28 ? 'בחודשים קצרים החיוב יחושב ליום האחרון בחודש.' : 'עסקה לפני יום החיוב תחויב באותו חודש; ביום החיוב או אחריו, בחודש הבא.'}>
        <IntInput id="c-day" value={day} onChange={setDay} max={31} placeholder="1–31" />
      </Field>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> פעיל</label>
      <p className="hint">אין צורך במספר כרטיס.</p>
    </Sheet>
  );
}

function LoanForm({ data, loan, onClose }: { data: AppData; loan?: Loan; onClose: () => void }) {
  const [name, setName] = useState(loan?.name ?? '');
  const [amount, setAmount] = useState<number | null>(loan?.monthlyAmountAgorot ?? null);
  const [day, setDay] = useState<number | null>(loan?.billingDay ?? null);
  const [start, setStart] = useState(loan?.startDate ?? todayLocal());
  const [end, setEnd] = useState(loan?.endDate ?? '');
  const [categoryId, setCategoryId] = useState(loan?.categoryId);
  const [active, setActive] = useState(loan?.active ?? true);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const save = async () => {
    if (!name.trim()) return setError('חסר שם');
    if (amount == null || amount <= 0) return setError('חסר החזר חודשי');
    if (day == null || !(day >= 1 && day <= 31)) return setError('יום חיוב בין 1 ל-31');
    if (!isValidDate(start)) return setError('תאריך התחלה לא תקין');
    if (end && (!isValidDate(end) || end < start)) return setError('תאריך סיום לא תקין');
    const rec = { name: name.trim(), monthlyAmountAgorot: amount, billingDay: day, startDate: start, endDate: end || undefined, categoryId, active };
    if (loan) await db.loans.update(loan.id, rec);
    else await db.loans.add({ id: uid(), ...rec });
    onClose();
  };
  const remove = async () => {
    await db.transaction('rw', db.loans, db.loanOverrides, async () => {
      await db.loanOverrides.where('loanId').equals(loan!.id).delete();
      await db.loans.delete(loan!.id);
    });
    onClose();
  };
  const preview = loan ? loanOccurrences(loan, data.overrides, monthOf(todayLocal()), addMonths(monthOf(todayLocal()), 5)) : [];
  const openEnded = loan ? loanLastMonth(loan).openEnded : !end;
  return (
    <Sheet title={loan ? 'עריכת הלוואה' : 'הלוואה חדשה'} onClose={onClose} footer={<><button className="btn primary" onClick={save}>שמירה</button>{loan && !confirmDel && <button className="btn danger ghost" onClick={() => setConfirmDel(true)}>מחיקה</button>}</>}>
      {error && <div className="alert error">{error}</div>}
      {confirmDel && <div className="alert warn">למחוק את ההלוואה וכל השינויים בה? <div className="row-actions"><button className="btn danger" onClick={remove}>מחיקה</button><button className="btn ghost" onClick={() => setConfirmDel(false)}>ביטול</button></div></div>}
      <Field label="שם" htmlFor="l-name"><input id="l-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: הלוואת רכב" /></Field>
      <div className="grid2">
        <Field label="החזר חודשי" htmlFor="l-amount"><AmountInput id="l-amount" value={amount} onChange={setAmount} /></Field>
        <Field label="יום חיוב" htmlFor="l-day"><IntInput id="l-day" value={day} onChange={setDay} max={31} placeholder="1–31" /></Field>
      </div>
      <div className="grid2">
        <Field label="תאריך התחלה" htmlFor="l-start"><input id="l-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="תאריך סיום" htmlFor="l-end"><input id="l-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      {openEnded && <p className="hint">בלי תאריך סיום התחזית מוצגת ל-12 חודשים קדימה. ההמשך לא ידוע.</p>}
      <Field label="קטגוריה (אופציונלי)" htmlFor="l-cat"><CategorySelect id="l-cat" categories={data.categories} value={categoryId} onChange={setCategoryId} allowEmptyLabel="ללא קטגוריה" /></Field>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> פעילה</label>
      <p className="hint">כל ההחזר (קרן וריבית) נספר כהוצאה. שינוי של חודש בודד נעשה מתוך רשימת העסקאות.</p>
      {preview.length > 0 && (
        <>
          <h4>החיובים הקרובים</h4>
          <ul className="plain-list compact">
            {preview.map((o) => <li key={o.key}><span>{formatDate(o.chargeDate)}</span><span>{o.status === 'excluded' ? 'לא נספר' : formatILS(o.amountAgorot)}</span></li>)}
          </ul>
        </>
      )}
    </Sheet>
  );
}

function CategoryForm({ data, category, onClose }: { data: AppData; category?: Category; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [replacement, setReplacement] = useState<string | undefined>();
  const used = category ? data.transactions.filter((t) => t.categoryId === category.id).length + data.loans.filter((l) => l.categoryId === category.id).length : 0;
  const save = async () => {
    const n = name.trim();
    if (!n) return setError('חסר שם');
    if (data.categories.some((c) => c.name === n && c.id !== category?.id)) return setError('כבר קיימת קטגוריה בשם הזה');
    if (category) await db.categories.update(category.id, { name: n });
    else await db.categories.add({ id: uid(), name: n, sortOrder: Math.max(0, ...data.categories.map((c) => c.sortOrder)) + 1, isSystem: false });
    onClose();
  };
  const move = async (dir: -1 | 1) => {
    const list = data.categories;
    const i = list.findIndex((c) => c.id === category!.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    await db.transaction('rw', db.categories, async () => {
      await db.categories.update(list[i].id, { sortOrder: list[j].sortOrder });
      await db.categories.update(list[j].id, { sortOrder: list[i].sortOrder });
    });
  };
  const remove = async () => {
    await deleteCategory(category!.id, replacement);
    onClose();
  };
  return (
    <Sheet title={category ? 'עריכת קטגוריה' : 'קטגוריה חדשה'} onClose={onClose} footer={<><button className="btn primary" onClick={save}>שמירה</button>{category && !deleting && <button className="btn danger ghost" onClick={() => setDeleting(true)}>מחיקה</button>}</>}>
      {error && <div className="alert error">{error}</div>}
      <Field label="שם" htmlFor="cat-name"><input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {category && (
        <div className="row-actions">
          <button className="btn small" onClick={() => move(-1)}>הזזה למעלה</button>
          <button className="btn small" onClick={() => move(1)}>הזזה למטה</button>
        </div>
      )}
      {deleting && category && (
        <div className="alert warn">
          {used > 0 ? <>יש {used} עסקאות והלוואות בקטגוריה. לאן להעביר אותן?</> : <>למחוק את הקטגוריה?</>}
          {used > 0 && <CategorySelect categories={data.categories.filter((c) => c.id !== category.id)} value={replacement} onChange={setReplacement} />}
          <div className="row-actions"><button className="btn danger" onClick={remove}>מחיקה{used > 0 ? ` והעברה ל"${categoryName(data.categories, replacement)}"` : ''}</button><button className="btn ghost" onClick={() => setDeleting(false)}>ביטול</button></div>
        </div>
      )}
    </Sheet>
  );
}

function RulesSection({ data }: { data: AppData }) {
  if (data.rules.length === 0) return null;
  return (
    <section className="card">
      <h3>כללי שיוך</h3>
      <p className="hint">נוצרים כשמשייכים בית עסק לקטגוריה. הכלל רק מציע; תמיד אפשר לשנות.</p>
      <ul className="plain-list">
        {data.rules.map((r) => (
          <li key={r.id} className="rule">
            <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => db.merchantRules.update(r.id, { enabled: e.target.checked })} /> {r.normalizedMerchant}</label>
            <CategorySelect categories={data.categories} value={r.categoryId} onChange={(v) => v && db.merchantRules.update(r.id, { categoryId: v })} />
            <button className="link danger" onClick={() => db.merchantRules.delete(r.id)} aria-label="מחיקת כלל">✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BackupSection() {
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ text: string; needsPassword: boolean } | null>(null);
  const [restorePw, setRestorePw] = useState('');
  const [preview, setPreview] = useState<PlainBackup | null>(null);

  const doExport = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const text = await exportBackup(password || undefined);
      const name = `expenses-backup-${todayLocal()}${password ? '-encrypted' : ''}.json`;
      const how = await saveBackupFile(text, name);
      setMsg(how === 'shared' ? 'הקובץ נשלח לשמירה.' : 'הקובץ הורד.');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f?: File) => {
    setErr(''); setMsg(''); setPreview(null);
    if (!f) return;
    const text = await f.text();
    if (isEncryptedBackup(text)) setPending({ text, needsPassword: true });
    else await check(text);
  };

  const check = async (text: string, pw?: string) => {
    try {
      setPreview(await readBackup(text, pw));
      setPending(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doRestore = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await restoreReplace(preview);
      setMsg('השחזור הושלם. כל הנתונים הוחלפו בנתוני הגיבוי.');
      setPreview(null);
    } catch (e) {
      setErr('השחזור נכשל. הנתונים הקיימים לא שונו. ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const counts = preview ? backupCounts(preview) : null;

  return (
    <section className="card">
      <h3>גיבוי ושחזור</h3>
      <p className="hint">הנתונים נשמרים רק במכשיר הזה, והדפדפן עלול למחוק אותם. מומלץ לשמור גיבוי ב"קבצים" באופן קבוע. שמירה ב-iCloud תלויה בתיקייה שתבחר.</p>
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert info">{msg}</div>}
      <Field label="סיסמה להצפנת הגיבוי (מומלץ)" htmlFor="b-pw" hint={password ? 'בלי הסיסמה לא ניתן יהיה לשחזר. אין דרך לשחזר סיסמה.' : 'גיבוי בלי סיסמה אינו מוצפן. כל מי שיש לו את הקובץ יוכל לקרוא אותו.'}>
        <input id="b-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button className="btn primary" onClick={doExport} disabled={busy}>ייצוא גיבוי</button>

      <h4>שחזור מקובץ</h4>
      <input type="file" accept="application/json,.json" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} aria-label="בחירת קובץ גיבוי" />
      {pending?.needsPassword && (
        <div className="field">
          <label htmlFor="r-pw">הגיבוי מוצפן. סיסמה:</label>
          <input id="r-pw" type="password" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} />
          <button className="btn" onClick={() => check(pending.text, restorePw)}>פתיחה</button>
        </div>
      )}
      {preview && counts && (
        <div className="alert warn">
          <div>גיבוי מ-{formatDate(preview.exportedAt.slice(0, 10))}: {counts.transactions} עסקאות, {counts.cards} כרטיסים, {counts.loans} הלוואות, {counts.categories} קטגוריות.</div>
          <div><strong>השחזור יחליף את כל הנתונים הקיימים.</strong></div>
          <div className="row-actions"><button className="btn danger" onClick={doRestore} disabled={busy}>החלפה מלאה</button><button className="btn ghost" onClick={() => setPreview(null)}>ביטול</button></div>
        </div>
      )}
    </section>
  );
}

function StorageSection() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState('');
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => e.usage != null && setUsage(`${(e.usage / 1024 / 1024).toFixed(1)}MB`)).catch(() => undefined);
  }, []);
  const ask = async () => setPersisted((await navigator.storage?.persist?.()) ?? false);
  return (
    <section className="card">
      <h3>אחסון ופרטיות</h3>
      <ul className="bullets">
        <li>כל הנתונים, התמונות והטקסט המזוהה נשארים במכשיר. אין שרת, אין חשבון ואין איסוף נתוני שימוש.</li>
        <li>הנתונים במכשיר אינם מוצפנים בנפרד על ידי האפליקציה. ההגנה היא נעילת המכשיר.</li>
        <li>צילומי המסך לא נשמרים אחרי הייבוא.</li>
      </ul>
      <div className="row-actions">
        <span className="muted">אחסון קבוע: {persisted == null ? 'לא ידוע' : persisted ? 'כן' : 'לא'}{usage && ` · בשימוש ${usage}`}</span>
        {persisted === false && <button className="btn small" onClick={ask}>בקשת אחסון קבוע</button>}
      </div>
    </section>
  );
}
