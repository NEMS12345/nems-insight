import type { AnalyticsReading } from "@/core/analytics/types";
import { aestMinuteOfDay } from "@/core/analytics/time";
import { demandByInterval } from "@/core/analytics/demand";

export interface SolarAssumptions {
  /** Annual generation per kWp installed (SE QLD ≈ 1,550 kWh/kWp/yr). */
  yieldKwhPerKwpYear: number;
  /** Indicative installed cost, $/W (commercial ≈ $1.00/W). */
  installCostPerWatt: number;
  /** Grid emissions factor, tonnes CO₂-e per MWh (QLD ≈ 0.73). */
  gridEmissionsTPerMwh: number;
  /** Daylight window used for generation and sizing (hours, AEST). */
  solarStartHour: number;
  solarEndHour: number;
  /**
   * Percentile of daytime load used to size the system. Sizing near a low percentile keeps
   * generation at/below load almost all the time, so nearly all output is self-consumed
   * (minimal export) — the agreed approach.
   */
  sizingPercentile: number;
}

export const DEFAULT_SOLAR_ASSUMPTIONS: SolarAssumptions = {
  yieldKwhPerKwpYear: 1550,
  installCostPerWatt: 1.0,
  gridEmissionsTPerMwh: 0.73,
  solarStartHour: 7,
  solarEndHour: 17,
  sizingPercentile: 0.1,
};

export interface SolarRecommendation {
  recommendedKwp: number;
  annualGenerationKwh: number;
  selfConsumedKwh: number;
  exportedKwh: number;
  selfConsumptionPct: number;
  annualSavingAud: number;
  simplePaybackYears: number | null;
  co2OffsetTonnes: number;
  assumptions: SolarAssumptions;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

/**
 * Per-kWp generation (kW) at a given minute of day: a half-sine across the daylight window
 * whose daily integral equals the daily yield. Zero outside the window.
 */
function genPerKwp(minute: number, a: SolarAssumptions): number {
  const start = a.solarStartHour * 60;
  const end = a.solarEndHour * 60;
  if (minute < start || minute >= end) return 0;
  const windowHours = (end - start) / 60;
  const dailyYield = a.yieldKwhPerKwpYear / 365;
  const peak = (Math.PI / 2) * (dailyYield / windowHours);
  return peak * Math.sin((Math.PI * (minute - start)) / (end - start));
}

/**
 * Recommend an appropriately sized solar PV system for a load, sized to minimise export.
 *
 * @param readings interval data for the metering point
 * @param avoidedRatePerKwh the value of a self-consumed kWh ($/kWh) — the variable per-kWh
 *   cost stack the client avoids (retail energy + network volume + environmental + market).
 */
export function recommendSolar(
  readings: ReadonlyArray<AnalyticsReading>,
  avoidedRatePerKwh: number,
  assumptions: Partial<SolarAssumptions> = {},
): SolarRecommendation {
  const a = { ...DEFAULT_SOLAR_ASSUMPTIONS, ...assumptions };
  const load = demandByInterval(readings); // [{ intervalStart, kw }], consumption only

  const startMin = a.solarStartHour * 60;
  const endMin = a.solarEndHour * 60;

  // Size to a low percentile of daytime load so output rarely exceeds load (minimal export).
  const daytimeLoads = load
    .filter((d) => {
      const m = aestMinuteOfDay(d.intervalStart);
      return m >= startMin && m < endMin;
    })
    .map((d) => d.kw)
    .sort((x, y) => x - y);

  const recommendedKwp = Math.round(percentile(daytimeLoads, a.sizingPercentile));

  // Walk the actual load, modelling generation per interval; self-consumed = min(gen, load).
  let genKwh = 0;
  let selfKwh = 0;
  let exportKwh = 0;
  const days = new Set<string>();
  for (const d of load) {
    const minute = aestMinuteOfDay(d.intervalStart);
    days.add(d.intervalStart.slice(0, 10));
    const genKw = recommendedKwp * genPerKwp(minute, a);
    if (genKw <= 0) continue;
    const hours = 0.5; // engine data is 30-minute; demandByInterval doesn't carry length
    genKwh += genKw * hours;
    const self = Math.min(genKw, d.kw);
    selfKwh += self * hours;
    exportKwh += Math.max(0, genKw - d.kw) * hours;
  }

  // Scale the period's figures to a full year.
  const dayCount = days.size || 1;
  const scale = 365 / dayCount;
  const annualGenerationKwh = genKwh * scale;
  const annualSelf = selfKwh * scale;
  const annualExport = exportKwh * scale;
  const total = annualSelf + annualExport;

  const annualSavingAud = annualSelf * avoidedRatePerKwh;
  const installCost = recommendedKwp * a.installCostPerWatt * 1000;
  const simplePaybackYears = annualSavingAud > 0 ? installCost / annualSavingAud : null;

  return {
    recommendedKwp,
    annualGenerationKwh,
    selfConsumedKwh: annualSelf,
    exportedKwh: annualExport,
    selfConsumptionPct: total === 0 ? 0 : annualSelf / total,
    annualSavingAud,
    simplePaybackYears,
    co2OffsetTonnes: (annualGenerationKwh / 1000) * a.gridEmissionsTPerMwh,
    assumptions: a,
  };
}
