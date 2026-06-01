import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind } from "@/core/analytics/types";
import { aestDate } from "@/core/analytics/time";
import type {
  Tariff,
  PeriodWindow,
  CostLine,
  CostResult,
  LossFactor,
  LossFactors,
} from "@/core/tariff/types";
import { inWindow } from "@/core/tariff/periods";
import { computeCost } from "@/core/tariff/engine";

/**
 * A retailer's pricing for ONE NMI. Retail contracts differ per metering point, so this is
 * stored per NMI (not baked into the shared network tariff). Energy is time-of-use on the
 * retailer's own peak window; environmental/market are per-kWh; supply/metering are daily.
 */
export interface RetailPlan {
  label: string;
  peakRatePerKwh: number;
  offpeakRatePerKwh: number;
  /** When the retail peak rate applies (the retailer's window, AEST). */
  peakWindow: PeriodWindow;
  environmentalPerKwh: number;
  marketPerKwh: number;
  supplyPerDay: number;
  meteringPerDay: number;
  /** Loss factors applied to energy charges (environmental/market use DLF only). */
  estimated: boolean;
}

/** Default retail plan, derived from the Origin invoice. Override per NMI with the real contract. */
export const DEFAULT_RETAIL_PLAN: RetailPlan = {
  label: "Origin (default — replace with the NMI's contract)",
  peakRatePerKwh: 0.072713,
  offpeakRatePerKwh: 0.093965,
  peakWindow: { dayTypes: ["weekday"], ranges: [{ startMin: 7 * 60, endMin: 21 * 60 }] },
  environmentalPerKwh: 0.010786, // SREC+LREC, certificate-adjusted
  marketPerKwh: 0.001261, // AEMO
  supplyPerDay: 0.032437, // AEMO FRC etc.
  meteringPerDay: 3.232876, // 2 meters
  estimated: true,
};

const ENERGY_LOSSES: LossFactor[] = ["MLF", "DLF"];

/** Compute the retail portion of a bill for an NMI from its plan. */
export function computeRetailCost(
  readings: ReadonlyArray<AnalyticsReading>,
  plan: RetailPlan,
  losses: LossFactors = {},
): { lines: CostLine[]; total: number } {
  const mlf = losses.mlf ?? 1;
  const dlf = losses.dlf ?? 1;
  const energyLoss = ENERGY_LOSSES.reduce((m, l) => m * (l === "MLF" ? mlf : dlf), 1);

  let peakKwh = 0;
  let offpeakKwh = 0;
  const days = new Set<string>();
  for (const r of readings) {
    if (channelKind(r.channel) !== "consumption") continue;
    days.add(aestDate(r.intervalStart));
    if (inWindow(r.intervalStart, plan.peakWindow)) peakKwh += r.value;
    else offpeakKwh += r.value;
  }
  const totalKwh = peakKwh + offpeakKwh;
  const dayCount = days.size;

  const lines: CostLine[] = [
    { label: "Retail energy (peak)", category: "retail", amount: peakKwh * plan.peakRatePerKwh * energyLoss },
    { label: "Retail energy (off-peak)", category: "retail", amount: offpeakKwh * plan.offpeakRatePerKwh * energyLoss },
    { label: "Environmental (SREC + LREC)", category: "retail", amount: totalKwh * plan.environmentalPerKwh * dlf },
    { label: "Regulated / market (AEMO)", category: "retail", amount: totalKwh * plan.marketPerKwh * dlf },
    { label: "Retail supply", category: "retail", amount: dayCount * plan.supplyPerDay },
    { label: "Metering", category: "retail", amount: dayCount * plan.meteringPerDay },
  ];

  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/** Value of a self-consumed daytime kWh from the retail plan ($/kWh) — for solar. */
export function retailMarginalPeakRate(plan: RetailPlan, losses: LossFactors = {}): number {
  const mlf = losses.mlf ?? 1;
  const dlf = losses.dlf ?? 1;
  return plan.peakRatePerKwh * mlf * dlf + plan.environmentalPerKwh * dlf + plan.marketPerKwh * dlf;
}

/**
 * Full modelled cost for an NMI = network tariff (shared) + retail plan (per-NMI). The two
 * are costed separately because they use different time windows, then combined.
 */
export function computeFullCost(
  readings: ReadonlyArray<AnalyticsReading>,
  networkTariff: Tariff,
  retailPlan: RetailPlan,
  losses: LossFactors = {},
): CostResult {
  const net = computeCost(readings, networkTariff, losses);
  const ret = computeRetailCost(readings, retailPlan, losses);
  return {
    currency: "AUD",
    lines: [...net.lines, ...ret.lines],
    networkTotal: net.networkTotal,
    retailTotal: ret.total,
    total: net.networkTotal + ret.total,
    days: net.days,
    energyByPeriod: net.energyByPeriod,
  };
}
