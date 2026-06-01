import type { Tariff, PeriodDefinition } from "@/core/tariff/types";

// Time-of-use windows for Energex Large TOU tariffs (AEST minutes from midnight).
//   Peak:     5pm–8pm weekdays            -> [1020, 1200)
//   Off-peak: 11am–1pm all days           -> [660, 780)
//   Shoulder: everything else (catch-all)
// Source: Energex Network Tariff Guide 2025-26, §3.3 (tariff 7200).
const ENERGEX_LARGE_TOU_PERIODS: PeriodDefinition = {
  peak: { dayTypes: ["weekday"], ranges: [{ startMin: 17 * 60, endMin: 20 * 60 }] },
  offpeak: {
    dayTypes: ["weekday", "weekend"],
    ranges: [{ startMin: 11 * 60, endMin: 13 * 60 }],
  },
};

/**
 * Energex 7200 — Large Time of Use Demand & Energy. The default network tariff for SAC
 * Large customers (>100 MWh/year). Network rates are the all-in NUOS figures from the
 * Energex 2026-27 Network Price List. Demand uses the kW variant (used when the meter has
 * no reactive/kVA data — which is our case; the kVA variant applies once Q-channel data
 * is present).
 *
 * RETAIL CHARGES ARE ESTIMATES, included only to complete a whole-of-bill scenario for
 * reconciliation. Replace `retail*` values with the client's actual retail contract rates.
 */
export const ENERGEX_7200: Tariff = {
  code: "7200",
  name: "Energex Large TOU Demand & Energy",
  network: "Energex",
  currency: "AUD",
  hasEstimatedCharges: true,
  periods: ENERGEX_LARGE_TOU_PERIODS,
  charges: [
    // ---- Network (published NUOS rates, 2026-27) ----
    {
      kind: "fixed_daily",
      category: "network",
      label: "Network fixed charge",
      ratePerDay: 9.257,
    },
    {
      kind: "energy",
      category: "network",
      label: "Network energy (peak)",
      period: "peak",
      rate: 0.01876,
    },
    {
      kind: "energy",
      category: "network",
      label: "Network energy (shoulder)",
      period: "shoulder",
      rate: 0.02947,
    },
    {
      kind: "energy",
      category: "network",
      label: "Network energy (off-peak)",
      period: "offpeak",
      rate: 0.01627,
    },
    {
      kind: "demand_monthly",
      category: "network",
      label: "Network demand (peak)",
      period: "peak",
      unit: "kW",
      rate: 15.459,
    },
    {
      kind: "demand_monthly",
      category: "network",
      label: "Network demand (shoulder)",
      period: "shoulder",
      unit: "kW",
      rate: 4.08,
    },

    // ---- Retail (ESTIMATED — placeholder for the client's actual contract) ----
    {
      kind: "fixed_daily",
      category: "retail",
      label: "Retail supply charge (estimated)",
      ratePerDay: 1.1,
    },
    {
      kind: "energy",
      category: "retail",
      label: "Retail energy peak (estimated)",
      period: "peak",
      rate: 0.16,
    },
    {
      kind: "energy",
      category: "retail",
      label: "Retail energy shoulder (estimated)",
      period: "shoulder",
      rate: 0.1,
    },
    {
      kind: "energy",
      category: "retail",
      label: "Retail energy off-peak (estimated)",
      period: "offpeak",
      rate: 0.06,
    },
  ],
};

// Tariff 7400 — Energex 11kV Time of Use Demand (CAC HV). Peak DEMAND window is 9am–9pm
// weekdays (Tariff Guide); network energy is a flat volume charge (no ToU). offpeak is
// empty because this tariff has no off-peak demand/energy split.
const ENERGEX_7400_PERIODS: PeriodDefinition = {
  peak: { dayTypes: ["weekday"], ranges: [{ startMin: 9 * 60, endMin: 21 * 60 }] },
  offpeak: { dayTypes: [], ranges: [] },
};

/**
 * Energex 7400 — 11kV TOU Demand, with the Origin retail charges that layer on top.
 *
 * Network rates and the Origin retail rates are taken from a real Origin tax invoice
 * (March 2026, NMI QB04077571). Demand is billed on kVA (apparent power). Two things are
 * APPROXIMATIONS pending confirmation, and are flagged in the cost output:
 *   1. Retail energy is modelled as a single blended rate (bill total ÷ kWh = 8.244 ¢/kWh).
 *      The bill's actual rates are peak 7.2713 ¢ / off-peak 9.3965 ¢, but Origin's TOU
 *      window definitions aren't on the bill, so the peak/off-peak split can't yet be
 *      modelled from intervals.
 *   2. Loss factors (MLF 1.0106 × DLF 1.0439) that the bill applies to energy are NOT yet
 *      applied here, so energy will read ~5.5% under the bill.
 */
export const ENERGEX_7400: Tariff = {
  code: "7400",
  name: "Energex 11kV TOU Demand + Origin retail",
  network: "Energex",
  currency: "AUD",
  hasEstimatedCharges: true,
  periods: ENERGEX_7400_PERIODS,
  charges: [
    // ---- Network (Energex 7400, from the bill, ex-GST) ----
    { kind: "fixed_daily", category: "network", label: "Network access (DUOS)", ratePerDay: 22.306 },
    { kind: "fixed_daily", category: "network", label: "Jurisdictional scheme (fixed)", ratePerDay: 0.573 },
    { kind: "fixed_monthly", category: "network", label: "DUOS connection unit charge", ratePerMonth: 1719.07 },
    { kind: "energy", category: "network", label: "Network volume (DUOS+TUOS+JS)", period: "all", rate: 0.01974 },
    { kind: "demand_monthly", category: "network", label: "Network peak demand (DUOS+TUOS)", period: "peak", unit: "kVA", rate: 11.011 },

    // ---- Retail (Origin, from the bill, ex-GST) ----
    // Effective per-kWh rates derived from the bill so each component reproduces the
    // invoice (they bake in loss factors and the environmental certificate %).
    { kind: "energy", category: "retail", label: "Retail energy (blended — see note)", period: "all", rate: 0.082443 },
    { kind: "energy", category: "retail", label: "Environmental (SREC + LREC, certificate-adjusted)", period: "all", rate: 0.011259 },
    { kind: "energy", category: "retail", label: "Regulated / market (AEMO)", period: "all", rate: 0.001316 },
    { kind: "fixed_daily", category: "retail", label: "AEMO FRC operations", ratePerDay: 0.032437 },
    { kind: "fixed_daily", category: "retail", label: "Metering (2 meters)", ratePerDay: 3.232876 },
  ],
};

/** Registry of tariffs the engine knows about (data-driven — add rows, not code). */
export const TARIFFS: Record<string, Tariff> = {
  "7200": ENERGEX_7200,
  "7400": ENERGEX_7400,
};

export function getTariff(code: string): Tariff | undefined {
  return TARIFFS[code];
}
