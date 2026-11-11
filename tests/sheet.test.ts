import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readTable, parseCsv } from '../src/lib/sheet';
import { parseMoneyCell, parseStatementTables, categoryFromHint } from '../src/lib/statementTable';

// Minimal xlsx shaped like the Cal export the user sent (title rows, header, 6 lines, footer notes).
function makeXlsx(rows: (string | number | null)[][], dateCols: number[] = []): Uint8Array {
  const strings: string[] = [];
  const sIdx = (s: string) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v == null) return '';
    const ref = `${col(ci)}${ri + 1}`;
    if (typeof v === 'number') return `<c r="${ref}"${dateCols.includes(ci) ? ' s="1"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="s"><v>${sIdx(v)}</v></c>`;
  }).join('')}</row>`).join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`),
    'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`),
    'xl/styles.xml': strToU8('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
  });
}

const CAL_ROWS: (string | number | null)[][] = [
  ['פירוט עסקאות'],
  [],
  ['עסקאות לחיוב ב-02/12/26 ₪'],
  ['תאריך\nעסקה', 'שם בית עסק', 'סכום\nעסקה', 'סכום\nחיוב', 'סוג\nעסקה', 'ענף', 'הערות'],
  ['3/11/26', 'שופרסל דיל רמלה לוד הצפון', '₪ 438.71', '₪ 438.71', 'רגילה', 'מזון ומשקאות', ''],
  ['31/10/26', 'הגפן 8', '₪ 48.00', '₪ 48.00', 'רגילה', 'מסעדות', ''],
  ['31/10/26', 'REAL-DEBRID*17256609', '€ 16.00', '₪ 57.57', 'רגילה', 'תקשורת ומחשבים', ''],
  ['25/10/26', 'שופרסל דיל רמלה לוד הצפון', '₪ 483.66', '₪ 483.66', 'רגילה', 'מזון ומשקאות', ''],
  ['25/10/26', 'שופרסל דיל רמלה לוד הצפון', '₪ -583.66', '₪ -583.66', 'זיכוי', 'מזון ומשקאות', ''],
  ['25/10/26', 'שופרסל דיל רמלה לוד הצפון', '₪ 583.66', '₪ 583.66', 'רגילה', 'מזון ומשקאות', ''],
  ['01/10/26', 'ACE', '₪ 600.00', '₪ 100.00', 'תשלומים', 'כלבו', 'תשלום 2 מתוך 6'],
  [],
  ['"את המידע המלא על כל עסקה אפשר למצוא באתר ובאפליקציית כאל. מידע על חיובים בבנק נמצא בתפריט תחת "סיכום חיובים בבנק'],
  ['לא מופיעות כאן עסקאות שחויבו מארנק מט"ח של כאל'],
];

describe('spreadsheet import (Cal-style export)', () => {
  it('reads xlsx and extracts every transaction line with charge amounts in ILS', () => {
    const tables = readTable(makeXlsx(CAL_ROWS), 'cal.xlsx');
    const { drafts, foundHeader } = parseStatementTables(tables, '2026-11-11');
    expect(foundHeader).toBe(true);
    expect(drafts.map((d) => [d.transactionDate, d.merchant, d.amountAgorot])).toEqual([
      ['2026-11-03', 'שופרסל דיל רמלה לוד הצפון', 43871],
      ['2026-10-31', 'הגפן 8', 4800],
      ['2026-10-31', 'REAL-DEBRID*17256609', 5757],
      ['2026-10-25', 'שופרסל דיל רמלה לוד הצפון', 48366],
      ['2026-10-25', 'שופרסל דיל רמלה לוד הצפון', -58366],
      ['2026-10-25', 'שופרסל דיל רמלה לוד הצפון', 58366],
      ['2026-10-01', 'ACE', 10000],
    ]);
    expect(drafts.every((d) => d.explicitChargeDate === '2026-12-02')).toBe(true);
    expect(drafts[6]).toMatchObject({ installmentIndex: 2, installmentCount: 6 });
    expect(drafts.every((d) => d.uncertain.length === 0)).toBe(true);
    expect(drafts[0].categoryHint).toBe('מזון ומשקאות');
  });

  it('converts Excel date numbers and Max-style headers with a charge-date column', () => {
    const rows = [
      ['תאריך עסקה', 'שם בית העסק', 'קטגוריה', 'סוג עסקה', 'סכום חיוב', 'מטבע חיוב', 'סכום עסקה מקורי', 'תאריך חיוב', 'הערות'],
      [46330, 'סונול', 'רכב ותחבורה', 'רגילה', 250, '₪', 250, '10-12-2026', ''],
    ];
    const { drafts } = parseStatementTables(readTable(makeXlsx(rows, [0]), 'max.xlsx'), '2026-11-11');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ transactionDate: '2026-11-04', merchant: 'סונול', amountAgorot: 25000, explicitChargeDate: '2026-12-10' });
  });

  it('reads CSV with quotes and a Windows-1255 style header', () => {
    const csv = 'תאריך רכישה,שם בית עסק,סכום עסקה,סכום חיוב\n"05/11/2026","פז, צומת",120.50,120.50\nסה"כ,,,120.50\n';
    const { drafts } = parseStatementTables([parseCsv(csv)], '2026-11-11');
    expect(drafts).toEqual([expect.objectContaining({ transactionDate: '2026-11-05', merchant: 'פז, צומת', amountAgorot: 12050 })]);
  });

  it('parses money cells', () => {
    expect(parseMoneyCell('₪ 438.71')).toEqual({ agorot: 43871, currency: 'ILS' });
    expect(parseMoneyCell('-583.66 ₪')?.agorot).toBe(-58366);
    expect(parseMoneyCell('583.66-')?.agorot).toBe(-58366);
    expect(parseMoneyCell('€ 16.00')?.currency).toBe('foreign');
    expect(parseMoneyCell('1,234.50')?.agorot).toBe(123450);
    expect(parseMoneyCell('')).toBeNull();
  });

  it('rejects old binary xls with a helpful message', () => {
    expect(() => readTable(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'a.xls')).toThrow('.xlsx');
  });

  it('maps card-company sectors to default categories', () => {
    const cats = ['מזון וסופר', 'מסעדות ובילויים', 'חשבונות ותקשורת', 'קניות'].map((name, i) => ({ id: String(i), name }));
    expect(categoryFromHint('מזון ומשקאות', cats)).toBe('0');
    expect(categoryFromHint('מסעדות', cats)).toBe('1');
    expect(categoryFromHint('תקשורת ומחשבים', cats)).toBe('2');
    expect(categoryFromHint('משהו אחר', cats)).toBeUndefined();
  });
});
