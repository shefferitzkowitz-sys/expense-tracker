import { unzipSync, strFromU8 } from 'fflate';

/**
 * Reads a spreadsheet into rows of cell text, entirely on the device.
 * Supports .xlsx, .csv/.txt, and the HTML-table ".xls" files many Israeli banks export.
 * Old binary .xls (BIFF) is not supported: the user is asked to save it as .xlsx or .csv.
 */
export type Table = string[][];

export class SheetError extends Error {}

export async function readTableFromFile(file: File): Promise<Table[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return readTable(buf, file.name);
}

export function readTable(buf: Uint8Array, name = ''): Table[] {
  const lower = name.toLowerCase();
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf); // ZIP: xlsx
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new SheetError('קובץ ‎.xls‎ ישן אינו נתמך. פתח אותו ושמור בתור ‎.xlsx‎ או ‎.csv‎, ונסה שוב.');
  }
  const text = decodeText(buf);
  if (/<table[\s>]/i.test(text)) return readHtmlTables(text);
  if (lower.endsWith('.xlsx')) throw new SheetError('קובץ האקסל פגום או לא נתמך');
  return [parseCsv(text)];
}

/** UTF-8 (with or without BOM); falls back to Windows-1255, common in Israeli bank exports. */
export function decodeText(buf: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 2) {
    try {
      return new TextDecoder('windows-1255').decode(buf);
    } catch {
      /* decoder not available */
    }
  }
  return utf8.replace(/^﻿/, '');
}

export function parseCsv(text: string): Table {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

function allText(xml: string): string {
  return [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => xmlText(m[1])).join('');
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel stores dates as day numbers since 1899-12-30. */
export function excelSerialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function readXlsx(buf: Uint8Array): Table[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  } catch {
    throw new SheetError('קובץ האקסל פגום או לא נתמך');
  }
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : '');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => allText(m[1]));

  // Which style indexes are date formats
  const styles = read('xl/styles.xml');
  const customDate = new Set(
    [...styles.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)]
      .filter((m) => /[dy]/i.test(m[2].replace(/\[[^\]]*\]|"[^"]*"/g, '')))
      .map((m) => Number(m[1])),
  );
  const cellXfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  const dateStyles = [...cellXfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map((m) => BUILTIN_DATE_FORMATS.has(Number(m[1])) || customDate.has(Number(m[1])));

  // Sheets in workbook order
  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  const relTarget = new Map([...rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const relTarget2 = new Map([...rels.matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)].map((m) => [m[2], m[1]]));
  const sheetPaths = [...wb.matchAll(/<sheet [^>]*r:id="([^"]+)"/g)]
    .map((m) => relTarget.get(m[1]) ?? relTarget2.get(m[1]))
    .filter((t): t is string => !!t)
    .map((t) => (t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '')));
  const paths = sheetPaths.length ? sheetPaths : Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort();

  return paths.map((p) => {
    const xml = read(p);
    const table: Table = [];
    for (const rm of xml.matchAll(/<row[^>]*?(?:r="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowIdx = rm[1] ? Number(rm[1]) - 1 : table.length;
      const row: string[] = [];
      for (const cm of rm[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const t = attrs.match(/t="(\w+)"/)?.[1];
        const sIdx = Number(attrs.match(/s="(\d+)"/)?.[1] ?? -1);
        const body = cm[2] ?? '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let text = '';
        if (t === 's' && v != null) text = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') text = allText(body);
        else if (v != null) {
          text = xmlText(v);
          if ((t == null || t === 'n') && dateStyles[sIdx] && /^\d+(\.\d+)?$/.test(text)) text = excelSerialToDate(Number(text));
        }
        const ci = ref ? colIndex(ref) : row.length;
        row[ci] = text.trim();
      }
      table[rowIdx] = Array.from(row, (c) => c ?? '');
    }
    return Array.from(table, (r) => r ?? []);
  });
}

function readHtmlTables(html: string): Table[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('table')].map((t) =>
    [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim())),
  );
}
