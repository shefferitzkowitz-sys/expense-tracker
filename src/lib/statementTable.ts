import { todayLocal, type ISODate } from './dates';
import { CHARGE_HINT, findDate, INSTALLMENT, type Draft } from './ocrParser';
import type { Table } from './sheet';

type Field = 'date' | 'merchant' | 'chargeAmount' | 'txAmount' | 'chargeDate' | 'type' | 'notes' | 'sector';

// Header names used by Israeli card companies (Cal, Max, Isracard/Amex, Diners) and generic exports.
const HEADERS: [Field, RegExp][] = [
  ['chargeDate', /^(תאריך|מועד)\s*(ה)?חיוב$/],
  ['date', /^(תאריך\s*(ה)?(עסקה|רכישה)|תאריך)$/],
  ['merchant', /^(שם\s*בית\s*(ה)?עסק|בית\s*(ה)?עסק|שם\s*(ה)?עסק|תיאור(\s*(ה)?עסקה)?|פרטים|merchant|description)$/i],
  ['chargeAmount', /^(סכום\s*(ה)?חיוב|סכום\s*לחיוב|סכום\s*בש["״]?ח|חיוב\s*בש["״]?ח)/],
  ['txAmount', /^(סכום\s*(ה)?עסקה(\s*מקורי)?|סכום\s*מקורי|סכום|amount)$/i],
  ['type', /^סוג\s*(ה)?עסקה$/],
  ['notes', /^(הערות|פירוט\s*נוסף|הערה)$/],
  ['sector', /^(ענף|קטגוריה|סוג\s*בית\s*עסק)$/],
];

const norm = (s: string) => s.replace(/[‎‏\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Maps header cells to fields if the row looks like a transaction table header. */
export function detectHeader(row: string[]): Partial<Record<Field, number>> | null {
  const map: Partial<Record<Field, number>> = {};
  row.forEach((cell, i) => {
    const c = norm(cell ?? '');
    if (!c || c.length > 40) return;
    for (const [field, re] of HEADERS) {
      if (map[field] == null && re.test(c)) {
        map[field] = i;
        break;
      }
    }
  });
  const ok = map.date != null && map.merchant != null && (map.chargeAmount != null || map.txAmount != null);
  return ok ? map : null;
}

export interface ParsedAmount {
  agorot: number;
  currency: 'ILS' | 'foreign';
}

/** Parses "₪ 438.71", "-583.66 ₪", "583.66-", "€ 16.00", "1,234.5". */
export function parseMoneyCell(text: string): ParsedAmount | null {
  const t = norm(text);
  if (!t) return null;
  const foreign = /[€$£]|USD|EUR|GBP|דולר|יורו/i.test(t);
  const negative = /^-|-$|^\(.*\)$|-\s*[₪€$£]|[₪€$£]\s*-/.test(t.replace(/\s/g, '')) || /-\s*\d/.test(t);
  const num = t.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(num)) return null;
  const agorot = Math.round(Number(num) * 100);
  return { agorot: negative ? -agorot : agorot, currency: foreign ? 'foreign' : 'ILS' };
}

/**
 * Converts statement tables into transaction drafts. Handles header rows anywhere in the sheet,
 * several tables in one sheet, "charged on <date>" section titles, credits (זיכוי), installments
 * and foreign-currency lines (the ILS charge amount is used). Footer and note rows are skipped.
 */
export function parseStatementTables(tables: Table[], today: ISODate = todayLocal()): { drafts: Draft[]; foundHeader: boolean } {
  const drafts: Draft[] = [];
  let foundHeader = false;
  for (const table of tables) {
    let map: Partial<Record<Field, number>> | null = null;
    let sectionChargeDate: ISODate | undefined;
    for (const raw of table) {
      const row = (raw ?? []).map((c) => norm(c ?? ''));
      if (row.every((c) => !c)) continue;
      const header = detectHeader(row);
      if (header) {
        map = header;
        foundHeader = true;
        continue;
      }
      const filled = row.filter(Boolean);
      if (!map || filled.length <= 2) {
        // Section titles such as "עסקאות לחיוב ב-02/12/26"
        const joined = filled.join(' ');
        if (CHARGE_HINT.test(joined)) {
          const d = findDate(joined, today);
          if (d) sectionChargeDate = d.date;
        }
        continue;
      }
      const cell = (f: Field) => (map![f] != null ? row[map![f]!] ?? '' : '');
      const date = findDate(cell('date'), today);
      const charge = parseMoneyCell(cell('chargeAmount'));
      const tx = parseMoneyCell(cell('txAmount'));
      if (!date || (!charge && !tx)) continue; // totals, notes, disclaimers

      const uncertain: string[] = [];
      let amount = charge ?? tx!;
      if (!charge && tx && tx.currency === 'foreign') uncertain.push('amountAgorot'); // foreign amount, ILS charge unknown yet
      const type = cell('type');
      const isCredit = /זיכוי|החזר|ביטול/.test(type);
      if (isCredit && amount.agorot > 0) amount = { ...amount, agorot: -amount.agorot };

      const instText = `${type} ${cell('notes')}`;
      const inst = instText.match(INSTALLMENT);
      let installmentIndex: number | undefined;
      let installmentCount: number | undefined;
      if (inst && Number(inst[1]) >= 1 && Number(inst[1]) <= Number(inst[2]) && Number(inst[2]) <= 60) {
        installmentIndex = Number(inst[1]);
        installmentCount = Number(inst[2]);
      }
      const rowChargeDate = findDate(cell('chargeDate'), today)?.date;
      const merchant = cell('merchant');
      if (!merchant) uncertain.push('merchant');
      if (date.uncertain) uncertain.push('transactionDate');

      drafts.push({
        transactionDate: date.date,
        merchant,
        amountAgorot: amount.agorot,
        installmentIndex,
        installmentCount,
        explicitChargeDate: rowChargeDate ?? sectionChargeDate,
        rawText: filled.join(' | '),
        uncertain,
        categoryHint: cell('sector') || undefined,
      });
    }
  }
  return { drafts, foundHeader };
}

// Card-company sector names → default category names. Only a suggestion; merchant rules win.
const SECTOR_TO_CATEGORY: [RegExp, string][] = [
  [/מזון|סופר|מכולת|משקאות|מאפ/, 'מזון וסופר'],
  [/מסעד|בילוי|פנאי|קפה|בר\b|אוכל מהיר|מזון מהיר/, 'מסעדות ובילויים'],
  [/דלק|רכב|תחבורה|חניה|כביש|מוסך|תחנות/, 'רכב ותחבורה'],
  [/תקשורת|מחשב|סלולר|חשמל|מים|גז|עירי|ארנונה|חשבונות/, 'חשבונות ותקשורת'],
  [/רפוא|בריאות|פארם|אופטיקה|קופת חולים/, 'בריאות'],
  [/ביטוח/, 'ביטוחים'],
  [/תיירות|טיס|מלון|נסיעות|חופש/, 'חופשות ונסיעות'],
  [/מנוי|סטרימינג|דיגיטל/, 'מנויים'],
  [/אופנה|הלבשה|הנעלה|ריהוט|בית|כלבו|אלקטרוניקה|קניות|ספרים|צעצוע/, 'קניות'],
  [/דיור|שכירות|ועד/, 'דיור'],
];

export function categoryFromHint(hint: string | undefined, categories: { id: string; name: string }[]): string | undefined {
  if (!hint) return undefined;
  const exact = categories.find((c) => c.name === hint.trim());
  if (exact) return exact.id;
  for (const [re, name] of SECTOR_TO_CATEGORY) {
    if (re.test(hint)) return categories.find((c) => c.name === name)?.id;
  }
  return undefined;
}
