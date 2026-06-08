// src/core/time — THE single place timezone conversion happens for the core.
//
// Decision (CLAUDE.md §5): interval timestamps are absolute instants (stored as Postgres
// timestamptz). Incoming NEM12 timestamps are interpreted in one documented SOURCE BASIS,
// defaulting to NEM time = AEST (UTC+10, no daylight saving) — that is the market basis NEM12
// data is recorded in. Time-of-use windows are then evaluated in the SITE's LOCAL clock time
// using an IANA timezone stored on the site (e.g. "Australia/Brisbane"), so ToU bucketing
// stays correct across daylight-saving transitions in DST states (NSW/VIC/ACT/TAS/SA).
//
// Pure TypeScript: only the built-in Date and Intl APIs. No DB/framework imports.

/** NEM time is AEST, UTC+10, with NO daylight saving. */
export const NEM_TIME_OFFSET_MINUTES = 600;
export const NEM_TIME_LABEL = "NEM time — AEST (UTC+10), no daylight saving";

/**
 * How to interpret the wall-clock time recorded in a source file. Default is NEM time.
 * Changing the basis is a single edit at the call site (or the default below).
 */
export type SourceBasis =
  | { kind: "fixed-offset"; offsetMinutes: number; label: string }
  | { kind: "iana"; timezone: string };

export const NEM_TIME_BASIS: SourceBasis = {
  kind: "fixed-offset",
  offsetMinutes: NEM_TIME_OFFSET_MINUTES,
  label: NEM_TIME_LABEL,
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function partsInZone(instant: Date, timezone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) m[p.type] = p.value;
  let hour = Number(m.hour);
  if (hour === 24) hour = 0; // some engines render midnight as 24
  return {
    year: Number(m.year), month: Number(m.month), day: Number(m.day),
    hour, minute: Number(m.minute), second: Number(m.second),
    weekday: WEEKDAY_INDEX[m.weekday] ?? 0,
  };
}

/** Offset (minutes) of `timezone` at `instant`: (local wall read as UTC) − actual UTC. */
function tzOffsetMinutes(instant: Date, timezone: string): number {
  const p = partsInZone(instant, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Site-local wall-clock parts of an absolute instant, for time-of-use bucketing. */
export interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number; // 0–23
  minute: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
  isWeekend: boolean;
  minuteOfDay: number; // 0–1439
  date: string; // YYYY-MM-DD (local)
}

export function instantToLocalParts(
  instant: Date | number,
  timezone: string,
): LocalParts {
  const dt = typeof instant === "number" ? new Date(instant) : instant;
  const p = partsInZone(dt, timezone);
  return {
    year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute,
    weekday: p.weekday,
    isWeekend: p.weekday === 0 || p.weekday === 6,
    minuteOfDay: p.hour * 60 + p.minute,
    date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
  };
}

/**
 * Convert a NEM12 interval — calendar day (YYYYMMDD) + interval index (0-based) + interval
 * length in minutes — into an absolute instant, interpreting the wall time in `basis`
 * (default NEM time). The instant is what gets stored as timestamptz.
 */
export function nem12IntervalToInstant(
  dateYyyymmdd: string,
  intervalIndex: number,
  intervalLengthMin: number,
  basis: SourceBasis = NEM_TIME_BASIS,
): Date {
  const y = Number(dateYyyymmdd.slice(0, 4));
  const mo = Number(dateYyyymmdd.slice(4, 6));
  const d = Number(dateYyyymmdd.slice(6, 8));
  const wallMinutes = intervalIndex * intervalLengthMin;

  if (basis.kind === "fixed-offset") {
    // local = UTC + offset  ⇒  UTC = localWall − offset
    return new Date(Date.UTC(y, mo - 1, d) + (wallMinutes - basis.offsetMinutes) * 60000);
  }

  // IANA basis: find the UTC instant whose local time in the zone equals the wall time.
  const guessUtc = Date.UTC(y, mo - 1, d) + wallMinutes * 60000;
  const off1 = tzOffsetMinutes(new Date(guessUtc), basis.timezone);
  let instant = guessUtc - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(instant), basis.timezone); // correct near DST edges
  if (off2 !== off1) instant = guessUtc - off2 * 60000;
  return new Date(instant);
}
