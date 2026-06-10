// Period coverage: how much of a bill's date range actually has interval data behind it.
//
// Why this matters for reconciliation: the cost engine prices whatever intervals exist. If a
// bill covers 31 days but only 20 days were ingested (a late or partial file), the modelled
// side silently prices ~20 days while the billed side is the full 31 — and a naive comparison
// would shout "investigate — likely billing error" when the truth is "we're missing data".
// Coverage lets reconciliation WITHHOLD a verdict ("insufficient-data") instead of
// manufacturing a false accusation — the one case where the headline feature could mislead a
// client.
//
// Granularity note (v1): a day counts as "covered" if it carries ANY reading. This catches the
// headline gap (whole days missing). Weighting by intervals-present-per-day (to catch a day
// with only a handful of intervals) is a future refinement, not built here. Pure TypeScript.

function toUtcDays(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Inclusive day count of a [periodStart, periodEnd] range (both "YYYY-MM-DD"). 0 if reversed. */
export function daysInPeriodInclusive(periodStart: string, periodEnd: string): number {
  const span = toUtcDays(periodEnd) - toUtcDays(periodStart) + 1;
  return span > 0 ? span : 0;
}

/**
 * Fraction (0–1) of the period's days that have at least one reading. `readingDates` are the
 * date portions ("YYYY-MM-DD") of the in-period interval readings; duplicates are fine.
 * Returns 0 for an empty/zero-length period.
 */
export function periodCoverage(
  readingDates: Iterable<string>,
  periodStart: string,
  periodEnd: string,
): number {
  const total = daysInPeriodInclusive(periodStart, periodEnd);
  if (total <= 0) return 0;
  const distinct = new Set<string>();
  for (const d of readingDates) {
    if (d >= periodStart && d <= periodEnd) distinct.add(d);
  }
  return Math.min(distinct.size / total, 1);
}
