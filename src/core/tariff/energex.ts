import type { Tariff, PeriodDefinition } from "@/core/tariff/types";

// These are NETWORK-only tariffs. Retail pricing is per-NMI (see retail.ts / RetailPlan)
// because retail contracts differ per metering point.

// Time-of-use windows for Energex 7200 (Large TOU). Source: Energex Network Tariff Guide
// §3.3. Peak 5–8pm weekdays, off-peak 11am–1pm daily, shoulder otherwise.
const ENERGEX_7200_PERIODS: PeriodDefinition = {
  peak: { dayTypes: ["weekday"], ranges: [{ startMin: 17 * 60, endMin: 20 * 60 }] },
  offpeak: {
    dayTypes: ["weekday", "weekend"],
    ranges: [{ startMin: 11 * 60, endMin: 13 * 60 }],
  },
};

/**
 * Energex 7200 — Large TOU Demand & Energy (SAC Large, >100 MWh/yr). Published NUOS rates
 * (2026-27). Demand uses the kW variant (kVA variant applies once reactive data is present).
 */
export const ENERGEX_7200: Tariff = {
  code: "7200",
  name: "Energex 7200 (SAC Large TOU)",
  network: "Energex",
  currency: "AUD",
  voltageClass: "LV",
  eligibility: { minAnnualMwh: 100 },
  hasEstimatedCharges: false,
  periods: ENERGEX_7200_PERIODS,
  charges: [
    { kind: "fixed_daily", category: "network", label: "Network fixed charge", ratePerDay: 9.257 },
    { kind: "energy", category: "network", label: "Network energy (peak)", period: "peak", rate: 0.01876 },
    { kind: "energy", category: "network", label: "Network energy (shoulder)", period: "shoulder", rate: 0.02947 },
    { kind: "energy", category: "network", label: "Network energy (off-peak)", period: "offpeak", rate: 0.01627 },
    { kind: "demand_monthly", category: "network", label: "Network demand (peak)", period: "peak", unit: "kW", rate: 15.459 },
    { kind: "demand_monthly", category: "network", label: "Network demand (shoulder)", period: "shoulder", unit: "kW", rate: 4.08 },
  ],
};

// Energex 7400 — 11kV TOU Demand (CAC HV). Network energy is a flat volume charge; demand is
// a single kVA peak charge measured 9am–9pm weekdays (Tariff Guide). Rates from the bill.
const ENERGEX_7400_PERIODS: PeriodDefinition = {
  peak: { dayTypes: ["weekday"], ranges: [{ startMin: 9 * 60, endMin: 21 * 60 }] },
  offpeak: { dayTypes: [], ranges: [] },
};

export const ENERGEX_7400: Tariff = {
  code: "7400",
  name: "Energex 7400 (11kV TOU Demand)",
  network: "Energex",
  currency: "AUD",
  voltageClass: "HV",
  hasEstimatedCharges: false,
  periods: ENERGEX_7400_PERIODS,
  charges: [
    { kind: "fixed_daily", category: "network", label: "Network access (DUOS)", ratePerDay: 22.306 },
    { kind: "fixed_daily", category: "network", label: "Jurisdictional scheme (fixed)", ratePerDay: 0.573 },
    { kind: "fixed_monthly", category: "network", label: "DUOS connection unit charge", ratePerMonth: 1719.07 },
    { kind: "energy", category: "network", label: "Network volume (DUOS+TUOS+JS)", period: "all", rate: 0.01974 },
    { kind: "demand_monthly", category: "network", label: "Network peak demand (DUOS+TUOS)", period: "peak", unit: "kVA", rate: 11.011 },
  ],
};

/** Registry of network tariffs (data-driven — add rows, not code). */
export const TARIFFS: Record<string, Tariff> = {
  "7200": ENERGEX_7200,
  "7400": ENERGEX_7400,
};

export function getTariff(code: string): Tariff | undefined {
  return TARIFFS[code];
}
