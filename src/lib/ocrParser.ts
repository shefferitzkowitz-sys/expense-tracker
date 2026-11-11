import { makeDate, isValidDate, parseDisplayDate, todayLocal, type ISODate } from './dates';
import { parseAmount } from './money';

export interface OcrLine {
  text: string;
  confidence: number; // 0..100
  /** The same line read by a Latin-only pass, which reads dates and amounts far more reliably than the Hebrew pass. */
  numText?: string;
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
  /** Why this row looks unlikely to be a real transaction; such rows start unselected in the review. */
  suspicious?: string;
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
export const CHARGE_HINT = /(מועד\s*חיוב|תאריך\s*חיוב|לחיוב\s*ב|חיוב\s*ב|יחויב|לתאריך)/;
/** Card-type column of Israeli statements (mobile wallet, standing order, card not shown). */
const CARD_TYPE = /ת+ש['.]?\s?נ?י?י?ד|לא\s?הוצג|ה\S{0,2}קבע/g;
/** Sector column values (e.g. "מכולת/סופר"); kept as a category hint and removed from the merchant name. */
const SECTOR = /[א-ת'"]+\/[א-ת'"]+|שירותי\s*רכב|כלי\s+בית|תש'\s?רשויות|אבזרי\s+אפנה|(?<=\s|^)(?:דלק|ביטוח|שונות|פארמה|תרבות|מחשבים)(?=\s|$)/g;
const NOISE = /^(סה["״]?כ|סך הכל|יתרה|מסגרת|עסקאות|פירוט|חיובים|בחיוב הקרוב|ש["״]?ח)(?=\s|$)/;
/** Words that mark account or offer text (interest, credit line, balances), never a purchase. */
const NON_TX = /(ריבית|קרדיט|משתנה|רבעוני|מסגרת|יתרת|יתרה|ניצול|זמינה|נקודות|סה["״]?כ|סך הכל|לתשלום|תקרת|אשראי זמין)/;
const PERCENT = /-?\d+(?:[.,]\d+)?\s*%|%\s*-?\d+(?:[.,]\d+)?/g;
const DISCOUNT = /(הנחה|הנחת|הטבה|החזר כספי|קשבק|cashback)/i;
/** A single statement line above this is far more likely a misread (limit, balance) than a purchase. */
const MAX_PLAUSIBLE = 2_000_000; // ₪20,000 in agorot

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
    // Adjacent amount columns can run together ("267.67267.67"): split after the second decimal digit.
    const splitAmounts = (t: string) => t.replace(/(\d\.\d{2})(?=\d)/g, '$1 ');
    text = splitAmounts(text);
    let num = line.numText ? splitAmounts(line.numText.replace(/[‎‏]/g, '')) : undefined;

    if (CHARGE_HINT.test(text)) {
      const d = (num && findDate(num, today)) || findDate(text, today);
      if (d) explicitChargeDate = d.date;
      continue;
    }

    const date = (num && findDate(num, today)) || findDate(text, today);
    if (date) {
      text = text.replace(date.match, ' ');
      if (num) num = num.replace(date.match, ' ');
    }
    let categoryHint: string | undefined;
    if (num || CARD_TYPE.test(text)) {
      CARD_TYPE.lastIndex = 0;
      // Two-pass OCR: numbers come from the Latin pass, so drop the Hebrew pass's misread digits and
      // the card-type and sector columns from the merchant text.
      text = text.replace(CARD_TYPE, ' ');
      const sectors = text.match(SECTOR);
      if (sectors) {
        categoryHint = sectors.join(' ');
        text = text.replace(SECTOR, ' ');
      }
    }

    const inst = text.match(INSTALLMENT);
    let installmentIndex: number | undefined;
    let installmentCount: number | undefined;
    if (inst && Number(inst[1]) >= 1 && Number(inst[1]) <= Number(inst[2]) && Number(inst[2]) <= 36) {
      installmentIndex = Number(inst[1]);
      installmentCount = Number(inst[2]);
      text = text.replace(inst[0], ' ');
    }

    const hadPercent = PERCENT.test(text);
    PERCENT.lastIndex = 0;
    if (hadPercent || NON_TX.test(text)) {
      // Interest rates, credit lines and balances: not a transaction.
      if (!date || hadPercent) continue;
    }
    text = text.replace(PERCENT, ' ');

    if (num) num = num.replace(PERCENT, ' ');
    const textAmounts = [...text.matchAll(AMOUNT)].map((m) => m[0]);
    const amounts = num ? [...num.matchAll(AMOUNT)].map((m) => m[0]) : textAmounts;
    const parsed = amounts.map((a) => parseAmount(a)).filter((a): a is number => a != null);
    const isDiscount = DISCOUNT.test(text);

    if (isDiscount && parsed.length === 1) {
      // A discount on its own line belongs to the purchase above it: keep the purchase at its net amount.
      const prev = drafts[drafts.length - 1];
      if (prev && prev.amountAgorot != null && Math.abs(parsed[0]) < Math.abs(prev.amountAgorot)) {
        prev.amountAgorot = prev.amountAgorot - Math.abs(parsed[0]) * Math.sign(prev.amountAgorot);
        prev.rawText += `\n${line.text}`;
        if (!prev.uncertain.includes('amountAgorot')) prev.uncertain.push('amountAgorot');
      }
      continue;
    }

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

    for (const a of textAmounts) text = text.replace(a, ' ');
    if (num) text = text.replace(/(^|\s)[\d.,/()|\\-]+(?=\s|$)/g, ' ').replace(/(הנחה|הנחת|הטבה)[^]*$/, ' ');
    const merchant = cleanMerchant(text.replace(/₪|ש["״]ח/g, ' '));
    let amountAgorot = parsed[0];
    if (parsed.length > 1) {
      const abs = parsed.map(Math.abs);
      const big = parsed[abs.indexOf(Math.max(...abs))];
      const small = parsed[abs.indexOf(Math.min(...abs))];
      if (isDiscount && Math.abs(small) * 2 < Math.abs(big)) {
        // "purchase … discount": the charge is the purchase minus the discount.
        amountAgorot = big - Math.abs(small) * Math.sign(big);
      } else {
        // Deal total and charge (or price after discount): the charge is the smaller absolute value.
        amountAgorot = small;
      }
    }
    if (amountAgorot === 0) continue;

    const uncertain: string[] = [];
    if (line.confidence < 70) uncertain.push('all');
    const transactionDate = date?.date ?? headerDate;
    if (!transactionDate) uncertain.push('transactionDate');
    else if (!date || date.uncertain) uncertain.push('transactionDate');
    if (merchant.length < 2) uncertain.push('merchant');
    if (new Set(parsed).size > 1) uncertain.push('amountAgorot');

    const draft: Draft = {
      transactionDate: layout === 'below' && !date ? undefined : transactionDate,
      merchant,
      amountAgorot,
      installmentIndex,
      installmentCount,
      rawText: line.text,
      uncertain,
      categoryHint,
    };
    if (Math.abs(amountAgorot) > MAX_PLAUSIBLE) draft.suspicious = 'סכום גבוה במיוחד';
    if (date) ownDate.add(draft);
    drafts.push(draft);
  }

  // Rows that never got a date (and the screenshot does have dated rows) are usually stray text.
  const anyDated = drafts.some((d) => d.transactionDate);
  for (const d of drafts) {
    if (!d.transactionDate && (anyDated || d.merchant.length < 2)) d.suspicious ??= 'לא נמצא תאריך';
  }

  if (explicitChargeDate) for (const d of drafts) d.explicitChargeDate = explicitChargeDate;
  return { drafts, explicitChargeDate };
}
