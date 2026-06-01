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

/** Registry of tariffs the engine knows about (data-driven — add rows, not code). */
export const TARIFFS: Record<string, Tariff> = {
  "7200": ENERGEX_7200,
};

export function getTariff(code: string): Tariff | undefined {
  return TARIFFS[code];
}
