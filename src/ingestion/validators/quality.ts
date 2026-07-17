import type { QualityFlag } from "@/core/types";

export interface QualitySummary {
  total: number;
  byFlag: Record<QualityFlag, number>;
  /** Fraction (0..1) of intervals that are NOT actual reads — i.e. estimated/substituted/missing. */
  nonActualFraction: number;
}

const ALL_FLAGS: QualityFlag[] = [
  "actual",
  "substituted",
  "final-substituted",
  "estimated",
  "null",
];

/**
 * Summarise data quality across a set of readings so reports can honestly state how much
 * of a period is estimated/substituted rather than actual. Never treat estimated as actual.
 */
export function summariseQuality(
  readings: ReadonlyArray<{ quality: QualityFlag }>,
): QualitySummary {
  const byFlag = Object.fromEntries(ALL_FLAGS.map((f) => [f, 0])) as Record<
    QualityFlag,
    number
  >;

  for (const r of readings) byFlag[r.quality]++;

  const total = readings.length;
  const actual = byFlag.actual;
  const nonActualFraction = total === 0 ? 0 : (total - actual) / total;

  return { total, byFlag, nonActualFraction };
}
