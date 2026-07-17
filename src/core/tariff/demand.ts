import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind, intervalPowerKw } from "@/core/analytics/types";
import { aestYearMonth } from "@/core/analytics/time";
import type { Tariff } from "@/core/tariff/types";
import { inWindow, classifyPeriod } from "@/core/tariff/periods";

export interface DemandShave {
  /** Demand-charge unit, kW or kVA. */
  unit: "kW" | "kVA";
  /** Theoretical annual saving from shaving each month's single highest in-window interval
   *  to the next-highest (i.e. clipping the spike). Theoretical, not achievable — site
   *  knowledge is needed to know what's realistically movable. */
  theoreticalAnnualSaving: number;
  /** Months of data the estimate is based on. */
  months: number;
}

/**
 * Estimate the demand-charge headroom by clipping each month's top in-window interval to
 * the second-highest. Demand resets monthly, so this sums per month rather than annualising
 * off a single peak, then scales the months present up to a year.
 */
export function demandShaveSaving(
  readings: ReadonlyArray<AnalyticsReading>,
  tariff: Tariff,
): DemandShave {
  const dc = tariff.charges.find((c) => c.kind === "demand_monthly");
  if (!dc || dc.kind !== "demand_monthly") {
    return { unit: "kW", theoreticalAnnualSaving: 0, months: 0 };
  }

  const perInterval = new Map<string, { real: number; reactive: number; length: number }>();
  for (const r of readings) {
    const k = channelKind(r.channel);
    if (k !== "consumption" && k !== "reactive") continue;
    const slot = perInterval.get(r.intervalStart) ?? { real: 0, reactive: 0, length: r.intervalLength };
    if (k === "consumption") slot.real += r.value;
    else slot.reactive += r.value;
    perInterval.set(r.intervalStart, slot);
  }

  const byMonth = new Map<string, number[]>();
  for (const [start, { real, reactive, length }] of perInterval) {
    const inScope = dc.window
      ? inWindow(start, dc.window)
      : classifyPeriod(start, tariff.periods) === dc.period;
    if (!inScope) continue;
    const kw = intervalPowerKw(real, length);
    const value = dc.unit === "kVA" ? Math.sqrt(kw * kw + intervalPowerKw(reactive, length) ** 2) : kw;
    const arr = byMonth.get(aestYearMonth(start)) ?? [];
    arr.push(value);
    byMonth.set(aestYearMonth(start), arr);
  }

  let saving = 0;
  for (const vals of byMonth.values()) {
    vals.sort((a, b) => b - a);
    if (vals.length >= 2) saving += (vals[0] - vals[1]) * dc.rate;
  }
  const months = byMonth.size;
  return {
    unit: dc.unit,
    months,
    theoreticalAnnualSaving: months > 0 ? (saving * 12) / months : 0,
  };
}
