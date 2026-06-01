import ExcelJS from "exceljs";
import type { ProfileRow } from "@/ingestion/parsers/meterProfile";

const REQUIRED_HEADERS = ["nmi", "kwh"];

function headerIndex(row: ExcelJS.Row): Map<string, number> | null {
  const map = new Map<string, number>();
  row.eachCell((cell, col) => {
    const v = cell.value;
    if (typeof v === "string") map.set(v.trim().toLowerCase(), col);
  });
  return REQUIRED_HEADERS.every((h) => map.has(h)) ? map : null;
}

/**
 * Read the meter-profile data sheet from an xlsx file into plain header-keyed rows. Picks
 * the first worksheet whose header row contains the expected columns (skips pivot/summary
 * sheets). Pure data extraction — the costing/quality logic lives in parseMeterProfile.
 */
export async function readMeterProfileRows(
  bytes: Uint8Array,
): Promise<ProfileRow[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs bundles an older Buffer type than @types/node; cast to bridge the gap.
  await wb.xlsx.load(Buffer.from(bytes) as never);

  for (const ws of wb.worksheets) {
    // Find the header row within the first few rows (some exports have title rows above).
    let headerRowNo = 0;
    let headers: Map<string, number> | null = null;
    for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
      headers = headerIndex(ws.getRow(r));
      if (headers) {
        headerRowNo = r;
        break;
      }
    }
    if (!headers) continue;

    const rows: ProfileRow[] = [];
    for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const obj: ProfileRow = {};
      let hasValue = false;
      for (const [name, col] of headers) {
        const v = row.getCell(col).value;
        obj[name] = v;
        if (v !== null && v !== undefined && v !== "") hasValue = true;
      }
      if (hasValue) rows.push(obj);
    }
    return rows;
  }

  return [];
}
