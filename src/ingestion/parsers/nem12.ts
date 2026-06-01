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

export interface Nem12Reading {
  nmi: string;
  channel: string; // NMI suffix, e.g. "E1", "B1", "Q1"
  intervalStart: string; // ISO 8601 with +10:00 offset
  intervalLength: number; // minutes (5 | 15 | 30)
  value: number;
  unit: ReadingUnit;
  quality: QualityFlag;
}

export interface Nem12ParseResult {
  readings: Nem12Reading[];
  nmis: string[];
  /** Fatal problems with specific rows; those rows are skipped. */
  errors: string[];
  /** Non-fatal oddities worth surfacing in the import audit. */
  warnings: string[];
}

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

/** Build an ISO timestamp at +10:00 for `date` (YYYYMMDD) plus `minutes` past midnight. */
function toIsoAest(date: string, minutes: number): string {
  const y = date.slice(0, 4);
  const mo = date.slice(4, 6);
  const d = date.slice(6, 8);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${y}-${mo}-${d}T${hh}:${mm}:00+10:00`;
}

interface ChannelContext {
  nmi: string;
  channel: string;
  unit: ReadingUnit;
  intervalLength: number;
  intervalsPerDay: number;
}

export function parseNem12(content: string): Nem12ParseResult {
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

        const n = ctx.intervalsPerDay;
        const valueFields = fields.slice(2, 2 + n);
        if (valueFields.length < n) {
          errors.push(
            `Line ${lineNo}: expected ${n} interval values for NMI ${ctx.nmi} ${ctx.channel}, found ${valueFields.length} — row skipped.`,
          );
          break;
        }

        // Default quality for the day comes from the field after the values.
        const dayQualityCode = (fields[2 + n] ?? "A").trim();
        const isVariable = dayQualityCode.charAt(0).toUpperCase() === "V";

        // Per-interval quality, seeded with the day default; 400 rows override ranges.
        const perInterval: QualityFlag[] = new Array(n);
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
              for (let k = start; k <= end && k <= n; k++) perInterval[k - 1] = q;
            } else {
              warnings.push(`Line ${j + 1}: malformed 400 record — ignored.`);
            }
            j++;
          }
          i = j - 1; // consume the 400 rows we just processed
        }

        for (let idx = 0; idx < n; idx++) {
          const raw = valueFields[idx];
          const value = Number(raw);
          if (!Number.isFinite(value)) {
            errors.push(
              `Line ${lineNo}: non-numeric value "${raw}" at interval ${idx + 1} for NMI ${ctx.nmi} ${ctx.channel} — interval skipped.`,
            );
            continue;
          }
          readings.push({
            nmi: ctx.nmi,
            channel: ctx.channel,
            intervalStart: toIsoAest(date, idx * ctx.intervalLength),
            intervalLength: ctx.intervalLength,
            value,
            unit: ctx.unit,
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
