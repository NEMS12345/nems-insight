import type { AnalyticsReading } from "@/core/analytics/types";
import { aestMinuteOfDay } from "@/core/analytics/time";
import { demandByInterval } from "@/core/analytics/demand";

export interface SolarAssumptions {
  /** Annual generation per kWp installed in year 1 (SE QLD ≈ 1,550 kWh/kWp/yr). */
  yieldKwhPerKwpYear: number;
  /** Indicative installed cost, $/W (commercial ≈ $1.00/W). */
  installCostPerWatt: number;
  /** Grid emissions factor, tonnes CO₂-e per MWh. */
  gridEmissionsTPerMwh: number;
  /** Daylight window used for generation and sizing (hours, AEST). */
  solarStartHour: number;
  solarEndHour: number;
  /** Panel output degradation per year (≈0.5%). */
  degradationPerYear: number;
  /** System life for the lifetime saving figure (years). */
  systemLifeYears: number;
  /** Year the inverter is replaced (lifetime value only). */
  inverterReplacementYear: number;
  /** Inverter replacement cost as a fraction of install cost. */
  inverterReplacementFraction: number;
}

export const DEFAULT_SOLAR_ASSUMPTIONS: SolarAssumptions = {
  yieldKwhPerKwpYear: 1550,
  installCostPerWatt: 1.0,
  gridEmissionsTPerMwh: 0.71,
  solarStartHour: 7,
  solarEndHour: 17,
  degradationPerYear: 0.005,
  systemLifeYears: 25,
  inverterReplacementYear: 11,
  inverterReplacementFraction: 0.15,
};

export interface SolarOption {
  kwp: number;
  annualGenerationKwh: number;
  selfConsumedKwh: number;
  exportedKwh: number;
  selfConsumptionPct: number;
  annualSavingAud: number;
  /** Undiscounted saving over system life: degradation + one inverter replacement. */
  lifetimeSavingAud: number;
  simplePaybackYears: number | null;
  co2OffsetTonnes: number;
}

export interface SolarRecommendation extends SolarOption {
  /** Best simple payback — the conservative, cash-constrained choice. */
  recommendedKwp: number;
  /** Largest lifetime value — the asset-owner choice (often larger). */
  maxValue: SolarOption;
  assumptions: SolarAssumptions;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Per-kWp generation (kW) at a minute of day: half-sine over the daylight window. */
function genPerKwp(minute: number, a: SolarAssumptions): number {
  const start = a.solarStartHour * 60;
  const end = a.solarEndHour * 60;
  if (minute < start || minute >= end) return 0;
  const windowHours = (end - start) / 60;
  const dailyYield = a.yieldKwhPerKwpYear / 365;
  const peak = (Math.PI / 2) * (dailyYield / windowHours);
  return peak * Math.sin((Math.PI * (minute - start)) / (end - start));
}

interface SizeOutcome {
  kwp: number;
  annualGenerationKwh: number;
  annualSelfKwh: number;
  annualExportKwh: number;
  annualSavingAud: number;
  paybackYears: number | null;
}

function evaluateSize(
  load: { intervalStart: string; kw: number }[],
  dayCount: number,
  kwp: number,
  avoidedRatePerKwh: number,
  a: SolarAssumptions,
): SizeOutcome {
  let gen = 0,
    self = 0,
    exp = 0;
  for (const d of load) {
    const genKw = kwp * genPerKwp(aestMinuteOfDay(d.intervalStart), a);
    if (genKw <= 0) continue;
    const hours = 0.5; // assumes 30-minute interval data
    gen += genKw * hours;
    self += Math.min(genKw, d.kw) * hours;
    exp += Math.max(0, genKw - d.kw) * hours;
  }
  const scale = 365 / (dayCount || 1);
  const annualSelf = self * scale;
  const annualSaving = annualSelf * avoidedRatePerKwh;
  const cost = kwp * a.installCostPerWatt * 1000;
  return {
    kwp,
    annualGenerationKwh: gen * scale,
    annualSelfKwh: annualSelf,
    annualExportKwh: exp * scale,
    annualSavingAud: annualSaving,
    paybackYears: annualSaving > 0 ? cost / annualSaving : null,
  };
}

/**
 * Recommend a solar PV size. Candidate sizes (percentiles of daytime load) are each modelled
 * against the actual load; we pick the one with the best simple payback (self-consumption is
 * an output, not the input), favouring designs that keep export low.
 */
export function recommendSolar(
  readings: ReadonlyArray<AnalyticsReading>,
  avoidedRatePerKwh: number,
  assumptions: Partial<SolarAssumptions> = {},
): SolarRecommendation {
  const a = { ...DEFAULT_SOLAR_ASSUMPTIONS, ...assumptions };
  const load = demandByInterval(readings);
  const days = new Set(load.map((d) => d.intervalStart.slice(0, 10)));
  const dayCount = days.size || 1;

  const startMin = a.solarStartHour * 60;
  const endMin = a.solarEndHour * 60;
  const daytime = load
    .filter((d) => {
      const m = aestMinuteOfDay(d.intervalStart);
      return m >= startMin && m < endMin;
    })
    .map((d) => d.kw)
    .sort((x, y) => x - y);

  const candidates = [0.1, 0.25, 0.4, 0.6]
    .map((p) => Math.round(percentile(daytime, p)))
    .filter((k) => k > 0);
  const uniqueCandidates = [...new Set(candidates)];

  const toOption = (o: SizeOutcome): SolarOption => {
    let lifetime = 0;
    for (let yr = 0; yr < a.systemLifeYears; yr++) {
      lifetime += o.annualSavingAud * Math.pow(1 - a.degradationPerYear, yr);
    }
    if (a.systemLifeYears > a.inverterReplacementYear) {
      lifetime -= o.kwp * a.installCostPerWatt * 1000 * a.inverterReplacementFraction;
    }
    const total = o.annualSelfKwh + o.annualExportKwh;
    return {
      kwp: o.kwp,
      annualGenerationKwh: o.annualGenerationKwh,
      selfConsumedKwh: o.annualSelfKwh,
      exportedKwh: o.annualExportKwh,
      selfConsumptionPct: total === 0 ? 0 : o.annualSelfKwh / total,
      annualSavingAud: o.annualSavingAud,
      lifetimeSavingAud: lifetime,
      simplePaybackYears: o.paybackYears,
      co2OffsetTonnes: (o.annualGenerationKwh / 1000) * a.gridEmissionsTPerMwh,
    };
  };

  const options = (uniqueCandidates.length > 0 ? uniqueCandidates : [0]).map((kwp) =>
    toOption(evaluateSize(load, dayCount, kwp, avoidedRatePerKwh, a)),
  );

  // Min-payback = conservative/cash-constrained; max-lifetime = asset-owner choice.
  const withPayback = options.filter((o) => o.simplePaybackYears !== null);
  const minPayback =
    withPayback.length > 0
      ? withPayback.reduce((b, o) => (o.simplePaybackYears! < b.simplePaybackYears! ? o : b))
      : options[0];
  const maxValue = options.reduce((b, o) => (o.lifetimeSavingAud > b.lifetimeSavingAud ? o : b));

  return { ...minPayback, recommendedKwp: minPayback.kwp, maxValue, assumptions: a };
}
