import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind, intervalPowerKw } from "@/core/analytics/types";

export interface DemandPoint {
  intervalStart: string;
  kw: number;
}

/**
 * Total consumption demand (kW) per interval. Where a NMI has multiple consumption
 * channels (e.g. E1 + E2), their energy is summed within each interval before converting
 * to power, so demand reflects total simultaneous grid draw.
 */
export function demandByInterval(
  readings: ReadonlyArray<AnalyticsReading>,
): DemandPoint[] {
  const byInterval = new Map<string, { kwh: number; length: number }>();

  for (const r of readings) {
    if (channelKind(r.channel) !== "consumption") continue;
    const existing = byInterval.get(r.intervalStart);
    if (existing) existing.kwh += r.value;
    else byInterval.set(r.intervalStart, { kwh: r.value, length: r.intervalLength });
  }

  return [...byInterval.entries()]
    .map(([intervalStart, { kwh, length }]) => ({
      intervalStart,
      kw: intervalPowerKw(kwh, length),
    }))
    .sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));
}

export interface PeakDemand {
  /** Maximum interval demand, kW. */
  kw: number;
  /** Interval (start time) at which the peak occurred, or null if no data. */
  at: string | null;
}

/**
 * Peak demand across the period.
 *
 * NOTE: this is the general "max interval demand" for charts/analysis. The BILLED demand
 * (window, kVA vs kW) comes from the network tariff and is computed in Phase 4.
 */
export function peakDemand(
  readings: ReadonlyArray<AnalyticsReading>,
): PeakDemand {
  let kw = 0;
  let at: string | null = null;
  for (const point of demandByInterval(readings)) {
    if (point.kw > kw) {
      kw = point.kw;
      at = point.intervalStart;
    }
  }
  return { kw, at };
}

/** Average interval demand across the period, kW. */
export function averageDemandKw(
  readings: ReadonlyArray<AnalyticsReading>,
): number {
  const points = demandByInterval(readings);
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.kw, 0) / points.length;
}
