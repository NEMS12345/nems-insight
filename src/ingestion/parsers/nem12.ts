// NEM12 parser (AEMO Meter Data File Format) — Layer 1, pure TypeScript.
//
// Scope (v1): record types 100 (header), 200 (NMI/channel details), 300 (interval data),
// 400 (variable interval quality), 900 (end). 500/550 (B2B) are ignored.
//
// A NEM12 file carries MULTIPLE channels per NMI — E1 (consumption), B1 (export/solar),
// Q1 (reactive) — so we emit readings keyed by (nmi, channel, interval start). Quality is
// first-class: every interval carries its NEM12 quality, and where a 300 row is flagged
// 'V' (variable) we apply the per-range qualities from its 400 rows.
//
// Timestamp convention: NEM12 timestamps are NEM time (AEST, UTC+10, no daylight saving).
// v1 is Energex/SE QLD only, where AEST == local time. We emit interval START times
// (reading i covers [start_i, start_i + length)). See CLAUDE.md §5.
// NOTE FOR FOUNDER: AEMO documents intervals as interval-ENDING; we store interval-START
// for analytics convenience. Flag if you want the other convention — easy to switch.

import type { QualityFlag, ReadingUnit } from "@/core/types";
import type { ParsedReading, ParseResult } from "@/ingestion/types";

// NEM12 emits the shared normalised shapes. Aliases kept for readability/back-compat.
export type Nem12Reading = ParsedReading;
export type Nem12ParseResult = ParseResult;

const QUALITY_BY_CODE: Record<string, QualityFlag> = {
  A: "actual",
  S: "substituted",
  F: "final-substituted",
  E: "estimated",
  N: "null",
};

function mapUnit(uom: string): { unit: ReadingUnit; warn?: string } {
  const u = uom.trim().toUpperCase();
  if (u === "KWH") return { unit: "kWh" };
  if (u === "KVARH") return { unit: "kVArh" };
  return { unit: "kWh", warn: `Unrecognised unit of measure "${uom}", treated as kWh` };
}

function qualityFromCode(code: string): QualityFlag | null {
  return QUALITY_BY_CODE[code.trim().charAt(0).toUpperCase()] ?? null;
}

/** Build an ISO timestamp for `date` (YYYYMMDD) plus `minutes` past local midnight, at the
 *  given UTC offset. Minutes ≥ 1440 roll into the next day so the timestamp is always valid. */
function toIso(date: string, minutes: number, offset: string): string {
  const base =
    Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) +
    minutes * 60000;
  const dt = new Date(base);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}` +
    `T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:00${offset}`
  );
}

function firstSundayOfMonth(year: number, month0: number): number {
  const dow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  return 1 + ((7 - dow) % 7);
}

/**
 * Whether a date falls inside the Australian eastern daylight-saving window (first Sunday of
 * October to first Sunday of April). Day-granularity — used only in "local" time basis.
 */
function isAuDst(date: string): boolean {
  const y = +date.slice(0, 4);
  const m = +date.slice(4, 6);
  const d = +date.slice(6, 8);
  if (m > 10 || (m === 10 && d >= firstSundayOfMonth(y, 9))) return true; // Oct–Dec
  if (m < 4 || (m === 4 && d < firstSundayOfMonth(y, 3))) return true; // Jan–Apr
  return false;
}

export interface Nem12Options {
  /**
   * Time basis of the timestamps in the file:
   * - "market" (default): AEMO market time = AEST year-round, NO daylight saving. Every day
   *   has the full 1440÷length intervals; a 46/50 count signals the file is actually local time.
   * - "local": local clock time, which may observe DST in NSW/VIC/ACT/TAS/SA — so transition
   *   days legitimately have fewer/more intervals (e.g. 46/50 for 30-minute data).
   */
  timeBasis?: "market" | "local";
  /** Standard-time UTC offset (market basis, and outside DST in local basis). Default "+10:00". */
  standardOffset?: string;
  /** Does the jurisdiction observe DST? (local basis only). Default false (e.g. QLD/WA/NT). */
  observesDst?: boolean;
  /** Daylight-time UTC offset used inside the DST window (local basis). Default "+11:00" (AEDT). */
  dstOffset?: string;
}

const DEFAULT_OPTIONS: Required<Nem12Options> = {
  timeBasis: "market",
  standardOffset: "+10:00",
  observesDst: false,
  dstOffset: "+11:00",
};

interface ChannelContext {
  nmi: string;
  channel: string;
  unit: ReadingUnit;
  intervalLength: number;
  intervalsPerDay: number;
}

export function parseNem12(
  content: string,
  options: Nem12Options = {},
): Nem12ParseResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const readings: Nem12Reading[] = [];
  const nmiSet = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    errors.push("File is empty.");
    return { readings, nmis: [], errors, warnings };
  }

  const firstFields = lines[0].split(",");
  if (firstFields[0] !== "100") {
    warnings.push('File does not start with a 100 header record — parsing anyway.');
  } else if ((firstFields[1] ?? "").toUpperCase() !== "NEM12") {
    warnings.push(`Header is not NEM12 (found "${firstFields[1]}").`);
  }

  let ctx: ChannelContext | null = null;

  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].split(",");
    const recordType = fields[0];
    const lineNo = i + 1;

    switch (recordType) {
      case "100":
      case "900":
      case "500":
      case "550":
        break; // header / footer / B2B — nothing to do

      case "200": {
        // 200,NMI,Config,RegisterID,NMISuffix,MDMStreamId,Serial,UOM,IntervalLength,Next
        const nmi = (fields[1] ?? "").trim();
        const channel = (fields[4] ?? "").trim();
        const uom = fields[7] ?? "";
        const intervalLength = Number(fields[8]);

        if (!nmi || !channel) {
          errors.push(`Line ${lineNo}: 200 record missing NMI or channel suffix.`);
          ctx = null;
          break;
        }
        if (!Number.isFinite(intervalLength) || 1440 % intervalLength !== 0) {
          errors.push(
            `Line ${lineNo}: invalid interval length "${fields[8]}" for NMI ${nmi} ${channel}.`,
          );
          ctx = null;
          break;
        }
        const { unit, warn } = mapUnit(uom);
        if (warn) warnings.push(`Line ${lineNo}: ${warn}.`);

        nmiSet.add(nmi);
        ctx = {
          nmi,
          channel,
          unit,
          intervalLength,
          intervalsPerDay: 1440 / intervalLength,
        };
        break;
      }

      case "300": {
        if (!ctx) {
          errors.push(`Line ${lineNo}: 300 record with no preceding 200 record — skipped.`);
          break;
        }
        const date = (fields[1] ?? "").trim();
        if (!/^\d{8}$/.test(date)) {
          errors.push(`Line ${lineNo}: invalid date "${fields[1]}" — row skipped.`);
          break;
        }

        const c = ctx;
        const expected = c.intervalsPerDay;
        const perHour = 60 / c.intervalLength;

        // Count the actual interval values — DO NOT assume `expected`. Values run from field 2
        // up to the quality-method field (the first NEM12 quality flag letter A/E/F/N/S/V).
        // This lets DST transition days carry ±perHour values without losing the day.
        let valEnd = 2;
        while (valEnd < fields.length && !/^[AEFNSV]/i.test((fields[valEnd] ?? "").trim())) {
          valEnd++;
        }
        const valueCount = valEnd - 2;

        // Flag interval-count anomalies (incl. DST transitions) rather than swallowing them.
        const springForward = valueCount === expected - perHour;
        const fallBack = valueCount === expected + perHour;
        if (fallBack) {
          warnings.push(`Line ${lineNo}: ${date} has ${valueCount} intervals (DST fall-back — 25-hour day).`);
        } else if (springForward) {
          warnings.push(`Line ${lineNo}: ${date} has ${valueCount} intervals (DST spring-forward — 23-hour day).`);
        } else if (valueCount !== expected) {
          warnings.push(
            `Line ${lineNo}: ${date} has ${valueCount} interval values, expected ${expected} (interval-count anomaly) — parsed as-is.`,
          );
        }
        if ((springForward || fallBack) && opts.timeBasis === "market") {
          warnings.push(`Line ${lineNo}: ${date} shows a DST interval count under market (AEST) basis — the file may be in local time; set timeBasis: "local".`);
        }

        const valueFields = fields.slice(2, valEnd);
        const dayQualityCode = (fields[valEnd] ?? "A").trim();
        const isVariable = dayQualityCode.charAt(0).toUpperCase() === "V";

        // Per-interval quality, seeded with the day default; 400 rows override ranges.
        const perInterval: QualityFlag[] = new Array(valueCount);
        const defaultQuality = isVariable
          ? "null"
          : qualityFromCode(dayQualityCode) ?? "null";
        if (!isVariable && qualityFromCode(dayQualityCode) === null) {
          warnings.push(
            `Line ${lineNo}: unrecognised quality "${dayQualityCode}" — treated as null.`,
          );
        }
        perInterval.fill(defaultQuality);

        // Apply any immediately-following 400 records (variable quality ranges).
        if (isVariable) {
          let j = i + 1;
          while (j < lines.length && lines[j].split(",")[0] === "400") {
            const f = lines[j].split(",");
            const start = Number(f[1]); // 1-based interval numbers
            const end = Number(f[2]);
            const q = qualityFromCode(f[3] ?? "");
            if (Number.isFinite(start) && Number.isFinite(end) && q) {
              for (let k = start; k <= end && k <= valueCount; k++) perInterval[k - 1] = q;
            } else {
              warnings.push(`Line ${j + 1}: malformed 400 record — ignored.`);
            }
            j++;
          }
          i = j - 1; // consume the 400 rows we just processed
        }

        // Timestamp for interval `idx`, honouring the time basis and (in local basis) the
        // repeated/skipped hour on DST transition days.
        const len = c.intervalLength;
        const TRANSITION_MIN = 120; // AU DST switches at 02:00 local
        const stampFor = (idx: number): string => {
          if (opts.timeBasis === "market") {
            return toIso(date, idx * len, opts.standardOffset);
          }
          if (opts.observesDst && springForward) {
            const pre = TRANSITION_MIN / len; // intervals before the 02:00→03:00 skip
            return idx < pre
              ? toIso(date, idx * len, opts.standardOffset)
              : toIso(date, TRANSITION_MIN + 60 + (idx - pre) * len, opts.dstOffset);
          }
          if (opts.observesDst && fallBack) {
            const dstFirst = (TRANSITION_MIN + 60) / len; // 00:00→03:00 at DST
            if (idx < dstFirst) return toIso(date, idx * len, opts.dstOffset);
            const repeatEnd = dstFirst + perHour; // 02:00→03:00 repeated at standard time
            return idx < repeatEnd
              ? toIso(date, TRANSITION_MIN + (idx - dstFirst) * len, opts.standardOffset)
              : toIso(date, TRANSITION_MIN + 60 + (idx - repeatEnd) * len, opts.standardOffset);
          }
          const offset = opts.observesDst && isAuDst(date) ? opts.dstOffset : opts.standardOffset;
          return toIso(date, idx * len, offset);
        };

        for (let idx = 0; idx < valueCount; idx++) {
          const raw = valueFields[idx];
          const value = Number(raw);
          if (!Number.isFinite(value)) {
            errors.push(
              `Line ${lineNo}: non-numeric value "${raw}" at interval ${idx + 1} for NMI ${c.nmi} ${c.channel} — interval skipped.`,
            );
            continue;
          }
          readings.push({
            nmi: c.nmi,
            channel: c.channel,
            intervalStart: stampFor(idx),
            intervalLength: len,
            value,
            unit: c.unit,
            quality: perInterval[idx],
          });
        }
        break;
      }

      case "400":
        // Standalone 400 (not consumed by a 300 above) — ignore quietly.
        break;

      default:
        warnings.push(`Line ${lineNo}: unknown record type "${recordType}" — ignored.`);
    }
  }

  return { readings, nmis: [...nmiSet], errors, warnings };
}
