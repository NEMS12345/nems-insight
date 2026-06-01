import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind } from "@/core/analytics/types";
import { aestDate } from "@/core/analytics/time";

export interface ConsumptionSummary {
  /** Total grid import (consumption channels), kWh. */
  importKwh: number;
  /** Total export/generation (export channels), kWh. */
  exportKwh: number;
  /** Net energy from the grid (import − export), kWh. */
  netKwh: number;
  /** Number of consumption intervals included. */
  intervalCount: number;
  /** Fraction (0..1) of consumption intervals that are not actual reads. */
  estimatedFraction: number;
}

/**
 * Headline consumption figures for a set of readings. Import and export are kept separate
 * (a solar site exports), and quality is surfaced so a report can say how much is estimated.
 */
export function consumptionSummary(
  readings: ReadonlyArray<AnalyticsReading>,
): ConsumptionSummary {
  let importKwh = 0;
  let exportKwh = 0;
  let intervalCount = 0;
  let nonActual = 0;

  for (const r of readings) {
    const kind = channelKind(r.channel);
    if (kind === "consumption") {
      importKwh += r.value;
      intervalCount++;
      if (r.quality !== "actual") nonActual++;
    } else if (kind === "export") {
      exportKwh += r.value;
    }
  }

  return {
    importKwh,
    exportKwh,
    netKwh: importKwh - exportKwh,
    intervalCount,
    estimatedFraction: intervalCount === 0 ? 0 : nonActual / intervalCount,
  };
}

export interface DailyConsumption {
  /** AEST calendar date, "YYYY-MM-DD". */
  date: string;
  importKwh: number;
}

/** Consumption (grid import) totalled per AEST day, sorted by date. */
export function dailyConsumption(
  readings: ReadonlyArray<AnalyticsReading>,
): DailyConsumption[] {
  const byDate = new Map<string, number>();

  for (const r of readings) {
    if (channelKind(r.channel) !== "consumption") continue;
    const date = aestDate(r.intervalStart);
    byDate.set(date, (byDate.get(date) ?? 0) + r.value);
  }

  return [...byDate.entries()]
    .map(([date, importKwh]) => ({ date, importKwh }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
