// All dates are local calendar dates as 'YYYY-MM-DD' strings. No UTC conversions.
export type ISODate = string;
export type MonthKey = string; // 'YYYY-MM'

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function makeDate(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = parts(date);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function todayLocal(): ISODate {
  const now = new Date();
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function monthOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** Billing day in a given month; days above the month length fall on the month's last day. */
export function dayInMonth(month: MonthKey, day: number): ISODate {
  const [y, m] = month.split('-').map(Number);
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)));
}

export function compareMonths(a: MonthKey, b: MonthKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function monthLabel(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number);
  return `${HEB_MONTHS[m - 1]} ${y}`;
}

export function shortMonthLabel(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number);
  return `${pad(m)}/${String(y).slice(2)}`;
}

export function formatDate(date: ISODate): string {
  const [y, m, d] = parts(date);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** Parses dd/mm/yy, dd/mm/yyyy, dd.mm.yy, dd-mm-yyyy. Returns null if invalid. */
export function parseDisplayDate(text: string): ISODate | null {
  const m = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const iso = makeDate(y, Number(m[2]), Number(m[1]));
  return isValidDate(iso) ? iso : null;
}

/**
 * Budget month: month X holds every charge from the day after the cycle end day in month X-1 up to the
 * cycle end day in month X (e.g. end day 10: November = 11/10–10/11). 0 means plain calendar months.
 */
let cycleEndDay = 10;
export function setCycleEndDay(day: number): void {
  cycleEndDay = Number.isInteger(day) && day >= 0 && day <= 31 ? day : 10;
}
export function getCycleEndDay(): number {
  return cycleEndDay;
}
export function budgetMonth(date: ISODate): MonthKey {
  const m = monthOf(date);
  if (cycleEndDay === 0) return m;
  const [y, mo, d] = parts(date);
  return d > Math.min(cycleEndDay, daysInMonth(y, mo)) ? addMonths(m, 1) : m;
}
/** First and last charge dates of a budget month. */
export function budgetRange(month: MonthKey): [ISODate, ISODate] {
  if (cycleEndDay === 0) return [dayInMonth(month, 1), dayInMonth(month, 31)];
  const prev = addMonths(month, -1);
  const [py, pm] = prev.split('-').map(Number);
  const prevEnd = Math.min(cycleEndDay, daysInMonth(py, pm));
  const start = prevEnd >= daysInMonth(py, pm) ? dayInMonth(month, 1) : makeDate(py, pm, prevEnd + 1);
  return [start, dayInMonth(month, cycleEndDay)];
}
