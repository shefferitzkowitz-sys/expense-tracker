import { useMemo, useState } from 'react';
import { db, uid } from '../db';
import { predictChargeDate } from '../lib/billing';
import { formatDate, isValidDate, todayLocal } from '../lib/dates';
import { suggestCategory } from '../lib/merchant';
import { formatILS, splitEvenly } from '../lib/money';
import { loanAmountOn } from '../lib/loans';
import { PAYMENT_METHODS, type ChargeLine, type PaymentMethod, type Transaction } from '../lib/types';
import { createTransaction, deleteTransaction, rememberMerchantCategory, updateTransaction } from '../services/transactions';
import { AmountInput, CategorySelect, Field, IntInput, Sheet } from './common';
import type { AppData } from './useData';

export function TxForm({ data, existing, onClose }: { data: AppData; existing?: Transaction; onClose: () => void }) {
  const activeCards = data.cards.filter((c) => c.active || c.id === existing?.cardId);
  const [sourceType, setSourceType] = useState<'card' | 'manual'>(existing?.sourceType ?? (activeCards.length ? 'card' : 'manual'));
  const [cardId, setCardId] = useState(existing?.cardId ?? activeCards[0]?.id);
  const [merchant, setMerchant] = useState(existing?.merchant ?? '');
  const [transactionDate, setTransactionDate] = useState(existing?.transactionDate ?? todayLocal());
  const [amount, setAmount] = useState<number | null>(existing?.amountAgorot ?? null);
  const [categoryId, setCategoryId] = useState<string | undefined>(existing?.categoryId);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [remember, setRemember] = useState(true);
  const [instInput, setInstInput] = useState<number | null>(1);
  const installments = instInput != null && instInput >= 1 ? instInput : 1;
  const [manualCharge, setManualCharge] = useState(existing ? existing.chargeDateSource !== 'predicted' : false);
  const [chargeDate, setChargeDate] = useState(existing?.chargeDate ?? '');
  const [status, setStatus] = useState(existing?.status ?? 'confirmed');
  const [note, setNote] = useState(existing?.note ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(existing?.paymentMethod ?? 'transfer');
  const [repeat, setRepeat] = useState(false);
  const [repeatInput, setRepeatInput] = useState<number | null>(12);
  const repeatMonths = repeat && repeatInput != null && repeatInput > 1 ? Math.min(repeatInput, 120) : 1;
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const card = data.cards.find((c) => c.id === cardId);
  const predicted = useMemo(() => {
    if (!isValidDate(transactionDate)) return '';
    if (sourceType === 'card' && card) return predictChargeDate(transactionDate, card.billingDay);
    return transactionDate;
  }, [transactionDate, sourceType, card]);
  const effectiveCharge = manualCharge && isValidDate(chargeDate) ? chargeDate : predicted;

  const onMerchantBlur = () => {
    if (!categoryTouched && !categoryId) {
      const s = suggestCategory(merchant, data.rules);
      if (s) setCategoryId(s);
    }
  };

  const save = async () => {
    setError('');
    if (!merchant.trim()) return setError('חסר תיאור / בית עסק');
    if (amount == null) return setError('חסר סכום');
    if (!isValidDate(transactionDate)) return setError('תאריך לא תקין');
    if (sourceType === 'card' && !cardId) return setError('יש לבחור כרטיס');
    if (manualCharge && !isValidDate(chargeDate)) return setError('מועד חיוב לא תקין');
    if (existing) {
      const isPredictedSource = !manualCharge;
      await updateTransaction(existing.id, {
        sourceType, cardId: sourceType === 'card' ? cardId : undefined, paymentMethod: sourceType === 'manual' ? paymentMethod : undefined,
        merchant: merchant.trim(), transactionDate, amountAgorot: amount,
        categoryId, chargeDate: existing.installmentGroupId && isPredictedSource ? existing.chargeDate : effectiveCharge,
        chargeDateSource: isPredictedSource ? 'predicted' : 'manual', status, note: note || undefined,
      });
      if (categoryTouched && remember) await rememberMerchantCategory(merchant, categoryId);
    } else {
      await createTransaction({
        sourceType, cardId: sourceType === 'card' ? cardId : undefined, merchant: merchant.trim(), transactionDate, amountAgorot: amount,
        categoryId, chargeDate: manualCharge ? chargeDate : undefined, installmentCount: sourceType === 'card' && installments > 1 ? installments : undefined,
        paymentMethod: sourceType === 'manual' ? paymentMethod : undefined, repeatMonths: sourceType === 'manual' ? repeatMonths : undefined,
        note: note || undefined, rememberCategory: categoryTouched && remember,
      });
    }
    onClose();
  };

  const remove = async (wholeGroup: boolean) => {
    if (existing) await deleteTransaction(existing.id, wholeGroup);
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'עריכת הוצאה' : 'הוצאה חדשה'}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save}>שמירה</button>
          {existing && !confirmDelete && <button className="btn danger ghost" onClick={() => setConfirmDelete(true)}>מחיקה</button>}
        </>
      }
    >
      {error && <div className="alert error" role="alert">{error}</div>}
      {confirmDelete && existing && (
        <div className="alert warn">
          <div>למחוק את העסקה?</div>
          <div className="row-actions">
            <button className="btn danger" onClick={() => remove(false)}>{existing.installmentGroupId ? 'רק תשלום זה' : existing.recurringGroupId ? 'רק החודש הזה' : 'מחיקה'}</button>
            {existing.installmentGroupId && <button className="btn danger" onClick={() => remove(true)}>כל התשלומים</button>}
            {existing.recurringGroupId && <button className="btn danger" onClick={() => remove(true)}>החודש הזה וכל הבאים</button>}
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>ביטול</button>
          </div>
        </div>
      )}
      <div className="segmented" role="tablist">
        <button className={sourceType === 'card' ? 'on' : ''} onClick={() => setSourceType('card')} disabled={!activeCards.length}>כרטיס אשראי</button>
        <button className={sourceType === 'manual' ? 'on' : ''} onClick={() => setSourceType('manual')}>בנק / מזומן</button>
      </div>
      {sourceType === 'manual' && (
        <Field label="אמצעי תשלום" htmlFor="f-pay">
          <select id="f-pay" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((k) => <option key={k} value={k}>{PAYMENT_METHODS[k]}</option>)}
          </select>
        </Field>
      )}
      {sourceType === 'card' && (
        <Field label="כרטיס" htmlFor="f-card">
          <select id="f-card" value={cardId} onChange={(e) => setCardId(e.target.value)}>
            {activeCards.map((c) => <option key={c.id} value={c.id}>{c.name} (חיוב ב-{c.billingDay})</option>)}
          </select>
        </Field>
      )}
      <Field label="בית עסק / תיאור" htmlFor="f-merchant">
        <input id="f-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} onBlur={onMerchantBlur} autoComplete="off" />
      </Field>
      <div className="grid2">
        <Field label={installments > 1 ? 'סכום העסקה הכולל' : 'סכום'} htmlFor="f-amount">
          <AmountInput id="f-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label={sourceType === 'manual' ? 'תאריך' : 'תאריך עסקה'} htmlFor="f-date">
          <input id="f-date" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
        </Field>
      </div>
      {!existing && sourceType === 'manual' && (
        <>
          <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> חוזר כל חודש (למשל הוראת קבע)</label>
          {repeat && (
            <Field label="למשך כמה חודשים" htmlFor="f-repeat" hint={repeatMonths > 1 && amount != null ? `${repeatMonths} חיובים של ${formatILS(amount)}, באותו יום בכל חודש. חודשים עתידיים מסומנים כחזויים.` : undefined}>
              <IntInput id="f-repeat" value={repeatInput} onChange={setRepeatInput} max={120} placeholder="12" />
            </Field>
          )}
        </>
      )}
      {!existing && sourceType === 'card' && (
        <Field label="מספר תשלומים" htmlFor="f-inst" hint={installments > 1 && amount != null ? `${installments} חיובים של כ-${formatILS(splitEvenly(amount, installments)[0])}; השארית בתשלום האחרון` : undefined}>
          <IntInput id="f-inst" value={instInput} onChange={setInstInput} max={36} placeholder="1" />
        </Field>
      )}
      {existing?.recurringGroupId && <div className="hint">הוצאה חודשית חוזרת</div>}
      {existing?.installmentGroupId && <div className="hint">תשלום {existing.installmentIndex} מתוך {existing.installmentCount}{existing.totalAgorot ? ` · עסקה כוללת ${formatILS(existing.totalAgorot)}` : ''}</div>}
      <Field label="קטגוריה" htmlFor="f-cat">
        <CategorySelect id="f-cat" categories={data.categories} value={categoryId} onChange={(v) => { setCategoryId(v); setCategoryTouched(true); }} />
      </Field>
      {categoryTouched && categoryId && (
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> לזכור את הקטגוריה לבית העסק הזה</label>
      )}
      <Field label="מועד חיוב" hint={!manualCharge ? (predicted ? `מחושב: ${formatDate(predicted)}${sourceType === 'manual' ? ' (תאריך ההוצאה)' : ''}` : '') : undefined}>
        <label className="check"><input type="checkbox" checked={manualCharge} onChange={(e) => { setManualCharge(e.target.checked); if (e.target.checked && !chargeDate) setChargeDate(predicted); }} /> קביעה ידנית</label>
        {manualCharge && <input type="date" value={chargeDate} onChange={(e) => setChargeDate(e.target.value)} aria-label="מועד חיוב ידני" />}
      </Field>
      {existing && (
        <Field label="סטטוס" htmlFor="f-status">
          <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value as Transaction['status'])}>
            <option value="confirmed">אושר</option>
            <option value="predicted">חזוי</option>
            <option value="excluded">לא נספר</option>
          </select>
        </Field>
      )}
      <Field label="הערה" htmlFor="f-note">
        <input id="f-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/** Edit one loan occurrence; optionally apply the new amount to all following months. */
export function LoanOccurrenceForm({ data, line, onClose }: { data: AppData; line: ChargeLine; onClose: () => void }) {
  const loan = data.loans.find((l) => l.id === line.loanId)!;
  const ov = data.overrides.find((o) => o.loanId === loan.id && o.chargeDate === line.occurrenceDate);
  const [amount, setAmount] = useState<number | null>(line.amountAgorot);
  const [date, setDate] = useState(line.chargeDate);
  const [excluded, setExcluded] = useState(!!ov?.excluded);
  const [applyForward, setApplyForward] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (amount == null) return setError('חסר סכום');
    if (!isValidDate(date)) return setError('תאריך לא תקין');
    await db.transaction('rw', db.loans, db.loanOverrides, async () => {
      if (applyForward) {
        const changes = (loan.amountChanges ?? []).filter((c) => c.fromDate < line.occurrenceDate!);
        changes.push({ fromDate: line.occurrenceDate!, amountAgorot: amount });
        await db.loans.update(loan.id, { amountChanges: changes });
      }
      const sameAsPlan = amount === loanAmountOn({ ...loan, amountChanges: applyForward ? [...(loan.amountChanges ?? []), { fromDate: line.occurrenceDate!, amountAgorot: amount }] : loan.amountChanges }, line.occurrenceDate!);
      const patch = {
        amountAgorot: sameAsPlan ? undefined : amount,
        actualDate: date !== line.occurrenceDate ? date : undefined,
        excluded,
        confirmed: ov?.confirmed,
      };
      if (ov) await db.loanOverrides.update(ov.id, patch);
      else await db.loanOverrides.add({ id: uid(), loanId: loan.id, chargeDate: line.occurrenceDate!, ...patch });
    });
    onClose();
  };

  const reset = async () => {
    if (ov) await db.loanOverrides.delete(ov.id);
    onClose();
  };

  return (
    <Sheet title={`${loan.name} · ${formatDate(line.occurrenceDate!)}`} onClose={onClose} footer={<><button className="btn primary" onClick={save}>שמירה</button>{ov && <button className="btn ghost" onClick={reset}>ביטול שינוי</button>}</>}>
      {error && <div className="alert error">{error}</div>}
      <div className="hint">החזר הלוואה. כל ההחזר (קרן וריבית) נספר כהוצאה.</div>
      <div className="grid2">
        <Field label="סכום" htmlFor="lo-amount"><AmountInput id="lo-amount" value={amount} onChange={setAmount} /></Field>
        <Field label="מועד חיוב" htmlFor="lo-date"><input id="lo-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={applyForward} onChange={(e) => setApplyForward(e.target.checked)} /> להחיל את הסכום גם על החודשים הבאים</label>
      <label className="check"><input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} /> לא לספור את החיוב הזה</label>
    </Sheet>
  );
}
