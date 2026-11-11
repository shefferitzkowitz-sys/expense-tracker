import { makeDate, isValidDate, parseDisplayDate, todayLocal, type ISODate } from './dates';
import { parseAmount } from './money';

export interface OcrLine {
  text: string;
  confidence: number; // 0..100
}

export interface Draft {
  transactionDate?: ISODate;
  merchant: string;
  amountAgorot?: number;
  installmentIndex?: number;
  installmentCount?: number;
  explicitChargeDate?: ISODate;
  rawText: string;
  uncertain: string[]; // field names that need review
  /** Category text from the statement (e.g. a card company's "sector" column), used only as a suggestion. */
  categoryHint?: string;
}

const HEB_MONTHS: Record<string, number> = {
  ינואר: 1, ינו: 1, פברואר: 2, פבר: 2, מרץ: 3, מרס: 3, אפריל: 4, אפר: 4, מאי: 5, יוני: 6, יולי: 7,
  אוגוסט: 8, אוג: 8, ספטמבר: 9, ספט: 9, אוקטובר: 10, אוק: 10, נובמבר: 11, נוב: 11, דצמבר: 12, דצמ: 12,
};

const FULL_DATE = /(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/;
const SHORT_DATE = /(?<![\d.,])(\d{1,2})\/(\d{1,2})(?![\d/])/;
const HEB_DATE = /(\d{1,2})\s*ב?([א-ת]{3,8})['׳]?(?:\s+(\d{4}))?/;
const AMOUNT = /-?₪?\s?-?\d{1,3}(?:,\d{3})*\.\d{1,2}(?!\d)-?|-?₪\s?\d+(?:\.\d{1,2})?|-?\d+\.\d{2}(?!\d)/g;
export const INSTALLMENT = /(?:תשלום\s*)?(\d{1,2})\s*(?:מתוך|מ-|\/)\s*(\d{1,2})(?:\s*תשלומים)?/;
export const CHARGE_HINT = /(מועד\s*חיוב|תאריך\s*חיוב|לחיוב\s*ב|חיוב\s*ב|יחויב)/;
const NOISE = /^(סה["״]?כ|סך הכל|יתרה|מסגרת|עסקאות|פירוט|חיובים|בחיוב הקרוב|ש["״]?ח)(?=\s|$)/;

/** Infers the year of a dd/mm date with no year: the most recent such date not after today. */
function inferYear(day: number, month: number, today: ISODate): ISODate | null {
  const y = Number(today.slice(0, 4));
  const thisYear = makeDate(y, month, day);
  const candidate = thisYear <= today ? thisYear : makeDate(y - 1, month, day);
  return isValidDate(candidate) ? candidate : null;
}

export function findDate(text: string, today: ISODate): { date: ISODate; match: string; uncertain: boolean } | null {
  const f = text.match(FULL_DATE);
  if (f) {
    const d = parseDisplayDate(`${f[1]}/${f[2]}/${f[3]}`);
    if (d) return { date: d, match: f[0], uncertain: false };
  }
  const s = text.match(SHORT_DATE);
  if (s) {
    const d = inferYear(Number(s[1]), Number(s[2]), today);
    if (d) return { date: d, match: s[0], uncertain: true };
  }
  const h = text.match(HEB_DATE);
  if (h && HEB_MONTHS[h[2]]) {
    const day = Number(h[1]);
    const month = HEB_MONTHS[h[2]];
    const d = h[3] ? makeDate(Number(h[3]), month, day) : inferYear(day, month, today);
    if (d && isValidDate(d)) return { date: d, match: h[0], uncertain: !h[3] };
  }
  return null;
}

function cleanMerchant(text: string): string {
  return text
    .replace(/[|•·*_~=<>{}[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–:.,]+|[\s\-–:.,]+$/g, '')
    .trim();
}

/**
 * Turns OCR lines of a card statement screenshot into transaction drafts. A line with an amount becomes
 * a draft; a date-only line (a date header) carries its date to the following lines. Fields that could
 * not be read with confidence are listed in `uncertain`. Nothing is invented: lines without an amount
 * are skipped.
 */
export function parseStatement(lines: OcrLine[], today: ISODate = todayLocal()): { drafts: Draft[]; explicitChargeDate?: ISODate } {
  const drafts: Draft[] = [];
  const ownDate = new Set<Draft>();
  // Some apps print the date on its own line under the merchant, others as a header above a group.
  // The first numeric date-only line decides which layout this screenshot uses.
  let layout: 'below' | 'above' | undefined;
  let headerDate: ISODate | undefined;
  let explicitChargeDate: ISODate | undefined;

  for (const line of lines) {
    let text = line.text.replace(/[‎‏]/g, '').trim();
    if (!text) continue;

    if (CHARGE_HINT.test(text)) {
      const d = findDate(text, today);
      if (d) explicitChargeDate = d.date;
      continue;
    }

    const date = findDate(text, today);
    if (date) text = text.replace(date.match, ' ');

    const inst = text.match(INSTALLMENT);
    let installmentIndex: number | undefined;
    let installmentCount: number | undefined;
    if (inst && Number(inst[1]) >= 1 && Number(inst[1]) <= Number(inst[2]) && Number(inst[2]) <= 36) {
      installmentIndex = Number(inst[1]);
      installmentCount = Number(inst[2]);
      text = text.replace(inst[0], ' ');
    }

    const amounts = [...text.matchAll(AMOUNT)].map((m) => m[0]);
    const parsed = amounts.map((a) => parseAmount(a)).filter((a): a is number => a != null);

    if (parsed.length === 0) {
      const prevDraft = drafts[drafts.length - 1];
      if (!date && installmentIndex && prevDraft && !prevDraft.installmentIndex) {
        // Installment note on its own line (its date may have been unreadable).
        prevDraft.installmentIndex = installmentIndex;
        prevDraft.installmentCount = installmentCount;
        if (layout !== 'above' && !ownDate.has(prevDraft) && !prevDraft.uncertain.includes('transactionDate')) prevDraft.uncertain.push('transactionDate');
        continue;
      }
      if (!date || cleanMerchant(text).length > 12) continue;
      const numeric = !HEB_DATE.test(date.match);
      if (numeric && layout === undefined) layout = drafts.length > 0 && !ownDate.has(drafts[drafts.length - 1]) ? 'below' : 'above';
      const prev = drafts[drafts.length - 1];
      if (numeric && layout === 'below' && prev && !ownDate.has(prev)) {
        prev.transactionDate = date.date;
        prev.uncertain = prev.uncertain.filter((f) => f !== 'transactionDate');
        if (date.uncertain) prev.uncertain.push('transactionDate');
        if (installmentIndex && !prev.installmentIndex) {
          prev.installmentIndex = installmentIndex;
          prev.installmentCount = installmentCount;
        }
        ownDate.add(prev);
      } else {
        headerDate = date.date; // date header line
      }
      continue;
    }
    if (NOISE.test(cleanMerchant(text))) continue;

    for (const a of amounts) text = text.replace(a, ' ');
    const merchant = cleanMerchant(text.replace(/₪|ש["״]ח/g, ' '));
    // When two amounts appear (deal total and charge), the charge is the smaller absolute value.
    const amountAgorot = parsed.length > 1 ? parsed.reduce((m, v) => (Math.abs(v) < Math.abs(m) ? v : m)) : parsed[0];

    const uncertain: string[] = [];
    if (line.confidence < 70) uncertain.push('all');
    const transactionDate = date?.date ?? headerDate;
    if (!transactionDate) uncertain.push('transactionDate');
    else if (!date || date.uncertain) uncertain.push('transactionDate');
    if (merchant.length < 2) uncertain.push('merchant');
    if (parsed.length > 1) uncertain.push('amountAgorot');

    const draft: Draft = {
      transactionDate: layout === 'below' && !date ? undefined : transactionDate,
      merchant,
      amountAgorot,
      installmentIndex,
      installmentCount,
      rawText: line.text,
      uncertain,
    };
    if (date) ownDate.add(draft);
    drafts.push(draft);
  }

  if (explicitChargeDate) for (const d of drafts) d.explicitChargeDate = explicitChargeDate;
  return { drafts, explicitChargeDate };
}
