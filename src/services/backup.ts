import { db, SCHEMA_VERSION, type ExpenseDB } from '../db';
import { isValidDate } from '../lib/dates';

const APP_ID = 'expense-tracker-pwa';
const TABLES = ['cards', 'categories', 'transactions', 'loans', 'loanOverrides', 'merchantRules', 'importBatches', 'settings'] as const;
type TableName = (typeof TABLES)[number];
export type BackupData = Record<TableName, Record<string, unknown>[]>;

export interface PlainBackup {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: string;
  data: BackupData;
}

interface EncryptedBackup {
  app: typeof APP_ID;
  encrypted: true;
  schemaVersion: number;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  ciphertext: string;
}

const PBKDF2_ITERATIONS = 600_000;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function chunkedB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function exportBackup(password?: string, d: ExpenseDB = db): Promise<string> {
  const data = {} as BackupData;
  await d.transaction('r', TABLES.map((t) => d.table(t)), async () => {
    for (const t of TABLES) data[t] = await d.table(t).toArray();
  });
  const plain: PlainBackup = { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
  const json = JSON.stringify(plain);
  if (!password) return json;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json)));
  const enc: EncryptedBackup = {
    app: APP_ID, encrypted: true, schemaVersion: SCHEMA_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64(salt) },
    cipher: { name: 'AES-GCM', iv: b64(iv) },
    ciphertext: chunkedB64(ct),
  };
  return JSON.stringify(enc);
}

export function isEncryptedBackup(text: string): boolean {
  try {
    return JSON.parse(text)?.encrypted === true;
  } catch {
    return false;
  }
}

/** Parses, decrypts and validates a backup file. Throws a Hebrew message on any problem; touches no data. */
export async function readBackup(text: string, password?: string): Promise<PlainBackup> {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('הקובץ אינו קובץ גיבוי תקין (JSON)');
  }
  const o = obj as Record<string, unknown>;
  if (o?.app !== APP_ID) throw new Error('הקובץ אינו גיבוי של האפליקציה הזו');
  if (o.encrypted) {
    if (!password) throw new Error('הגיבוי מוצפן. יש להזין סיסמה');
    const e = o as unknown as EncryptedBackup;
    try {
      const key = await deriveKey(password, unb64(e.kdf.salt), e.kdf.iterations);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.cipher.iv) }, key, unb64(e.ciphertext));
      return readBackup(new TextDecoder().decode(pt));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('הקובץ')) throw err;
      throw new Error('סיסמה שגויה או קובץ פגום');
    }
  }
  const b = o as unknown as PlainBackup;
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) throw new Error('גרסת הגיבוי חדשה מהאפליקציה. יש לעדכן את האפליקציה');
  validate(b.data);
  return b;
}

function validate(data: BackupData | undefined): void {
  if (!data || typeof data !== 'object') throw new Error('חסרים נתונים בגיבוי');
  for (const t of TABLES) if (!Array.isArray(data[t])) throw new Error(`חסרה טבלה: ${t}`);
  const ids = (t: TableName) => new Set(data[t].map((r) => r.id as string));
  const cards = ids('cards');
  const cats = ids('categories');
  const loans = ids('loans');
  for (const r of data.transactions) {
    if (typeof r.id !== 'string' || typeof r.merchant !== 'string' || !Number.isInteger(r.amountAgorot)) throw new Error('עסקה לא תקינה בגיבוי');
    if (!isValidDate(r.chargeDate as string) || !isValidDate(r.transactionDate as string)) throw new Error('תאריך לא תקין בעסקה');
    if (r.cardId && !cards.has(r.cardId as string)) throw new Error('עסקה מפנה לכרטיס שאינו קיים');
    if (r.categoryId && !cats.has(r.categoryId as string)) throw new Error('עסקה מפנה לקטגוריה שאינה קיימת');
  }
  for (const r of data.loans) {
    if (!Number.isInteger(r.monthlyAmountAgorot) || !isValidDate(r.startDate as string)) throw new Error('הלוואה לא תקינה בגיבוי');
  }
  for (const r of data.loanOverrides) if (!loans.has(r.loanId as string)) throw new Error('חריג מפנה להלוואה שאינה קיימת');
}

export function backupCounts(b: PlainBackup): Record<TableName, number> {
  return Object.fromEntries(TABLES.map((t) => [t, b.data[t].length])) as Record<TableName, number>;
}

/** Full replace, in a single transaction: if anything fails, the existing data stays untouched. */
export async function restoreReplace(b: PlainBackup, d: ExpenseDB = db): Promise<void> {
  await d.transaction('rw', TABLES.map((t) => d.table(t)), async () => {
    for (const t of TABLES) await d.table(t).clear();
    for (const t of TABLES) await d.table(t).bulkAdd(b.data[t]);
  });
}

export function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Uses the iOS share sheet ("Save to Files") when available; otherwise a normal download. */
export async function saveBackupFile(text: string, filename: string): Promise<'shared' | 'downloaded'> {
  const file = new File([text], filename, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  downloadText(text, filename);
  return 'downloaded';
}
