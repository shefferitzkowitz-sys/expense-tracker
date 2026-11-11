// Amounts are integer agorot (1 ILS = 100 agorot).
export type Agorot = number;

export function toAgorot(shekels: number): Agorot {
  return Math.round(shekels * 100);
}

/** Parses user or OCR text such as "1,234.50", "₪ 99.9", "-45" into agorot. */
export function parseAmount(text: string): Agorot | null {
  const cleaned = text.replace(/[₪\s]/g, '').replace(/ש"ח|ש״ח|NIS|ILS/gi, '');
  if (!/^-?[\d,]*\.?\d+-?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-') || cleaned.endsWith('-');
  const num = Number(cleaned.replace(/-/g, '').replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  return toAgorot(negative ? -num : num);
}

const fmt = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRound = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });

export function formatILS(a: Agorot, round = false): string {
  return `₪${(round ? fmtRound : fmt).format(a / 100)}`;
}

export function agorotToInput(a: Agorot): string {
  return (a / 100).toFixed(2);
}

/** Splits total into n parts of whole agorot; the rounding remainder goes to the last part. */
export function splitEvenly(total: Agorot, n: number): Agorot[] {
  const base = Math.trunc(total / n);
  const parts = Array<Agorot>(n).fill(base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}
