import type { ParsedReading, ParseResult } from "@/ingestion/types";
import type { ReadingUnit } from "@/core/types";

// Parser for the tabular "30-minute meter profile" export (meter data agent / portal),
// one row per meter per interval with explicit columns. Unlike NEM12 it carries
// consumption, export and reactive in separate columns, and identifies individual meters.
//
// Per the agreed handling, each meter_serial is kept as its OWN metering point (not summed).
// Channels are mapped to the same suffix vocabulary the rest of the system uses:
//   kwh -> E1 (consumption), generated_kwh -> B1 (export), kvarh -> Q1 (reactive).
//
// Timestamps: the source is interval-ENDING; we normalise to interval-START in AEST
// (start = day 00:00 + (period-1) * interval minutes) to match how NEM12 data is stored.

export type ProfileRow = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Extract a wall-clock YYYY-MM-DD from a Date (treated as wall time) or string. */
function ymd(v: unknown): string | null {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

function toIsoAest(date: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${date}T${hh}:${mm}:00+10:00`;
}

const CHANNELS: { column: string; channel: string; unit: ReadingUnit }[] = [
  { column: "kwh", channel: "E1", unit: "kWh" },
  { column: "generated_kwh", channel: "B1", unit: "kWh" },
  { column: "kvarh", channel: "Q1", unit: "kVArh" },
];

export function parseMeterProfile(rows: ReadonlyArray<ProfileRow>): ParseResult {
  const readings: ParsedReading[] = [];
  const nmiSet = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Which channel columns are actually present in this file.
  const present = new Set<string>();
  if (rows.length > 0) {
    for (const c of CHANNELS) if (c.column in rows[0]) present.add(c.column);
  }

  rows.forEach((row, i) => {
    const lineNo = i + 2; // +1 for 0-index, +1 for header row
    const nmi = row.nmi == null ? "" : String(row.nmi).trim();
    const meterSerial =
      row.meter_serial == null ? undefined : String(row.meter_serial).trim();
    const period = num(row.period);
    const length = num(row.interval) ?? 30;
    const date = ymd(row.date);

    if (!nmi) {
      errors.push(`Row ${lineNo}: missing NMI — skipped.`);
      return;
    }
    if (date === null || period === null) {
      errors.push(`Row ${lineNo}: missing date or period for NMI ${nmi} — skipped.`);
      return;
    }

    const intervalStart = toIsoAest(date, (period - 1) * length);
    nmiSet.add(nmi);

    for (const c of CHANNELS) {
      if (!present.has(c.column)) continue;
      const value = num(row[c.column]);
      if (value === null) continue; // blank cell for this channel/meter
      readings.push({
        nmi,
        meterSerial,
        channel: c.channel,
        intervalStart,
        intervalLength: length,
        value,
        unit: c.unit,
        quality: "actual", // this format carries no quality codes
      });
    }
  });

  if (readings.length === 0 && errors.length === 0) {
    errors.push("No interval rows found (expected a sheet with nmi/kwh columns).");
  }

  return { readings, nmis: [...nmiSet], errors, warnings };
}
