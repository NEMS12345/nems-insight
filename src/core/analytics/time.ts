// Time helpers fixed to NEM time (AEST, UTC+10, no daylight saving).
// v1 is Energex / SE QLD only, where AEST is local time year-round. Keeping this in one
// place means the rest of the core never does ad-hoc timezone maths.

const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

function shifted(iso: string): Date {
  return new Date(Date.parse(iso) + AEST_OFFSET_MS);
}

/** Local (AEST) calendar date of an interval, as "YYYY-MM-DD". */
export function aestDate(iso: string): string {
  return shifted(iso).toISOString().slice(0, 10);
}

/** Minutes past local (AEST) midnight, 0..1439. */
export function aestMinuteOfDay(iso: string): number {
  const d = shifted(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Format a minute-of-day as "HH:MM" for labels. */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * "weekday" (Mon–Fri) or "weekend" (Sat/Sun) in AEST. Per the Energex guide, weekdays
 * include public holidays, so no holiday calendar is needed.
 */
export function aestDayType(iso: string): "weekday" | "weekend" {
  const day = shifted(iso).getUTCDay(); // 0 = Sun .. 6 = Sat
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

/** AEST calendar month of an interval, as "YYYY-MM" (for monthly demand charges). */
export function aestYearMonth(iso: string): string {
  return shifted(iso).toISOString().slice(0, 7);
}
