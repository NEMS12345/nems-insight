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
import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind } from "@/core/analytics/types";
import { aestDate } from "@/core/analytics/time";

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

/** Interval-level coverage for the primary consumption stream in a billing period. */
export function periodIntervalCoverage(
  readings: ReadonlyArray<AnalyticsReading>,
  periodStart: string,
  periodEnd: string,
): number {
  const byChannel = new Map<string, AnalyticsReading[]>();
  for (const r of readings) {
    if (channelKind(r.channel) !== "consumption") continue;
    const date = aestDate(r.intervalStart);
    if (date < periodStart || date > periodEnd) continue;
    const rows = byChannel.get(r.channel) ?? [];
    rows.push(r);
    byChannel.set(r.channel, rows);
  }

  const primary = [...byChannel.values()].sort((a, b) => b.length - a.length)[0];
  if (!primary?.length) return 0;

  const lengthCounts = new Map<number, number>();
  for (const r of primary) {
    lengthCounts.set(r.intervalLength, (lengthCounts.get(r.intervalLength) ?? 0) + 1);
  }
  const intervalLength = [...lengthCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const expected = daysInPeriodInclusive(periodStart, periodEnd) * (1440 / intervalLength);
  if (expected <= 0) return 0;
  return Math.min(new Set(primary.map((r) => r.intervalStart)).size / expected, 1);
}
