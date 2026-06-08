// Energex (SE QLD) network tariffs expressed in the general schema — POPULATED with real
// published figures. Energex is the only DNSP fully populated for v1.
//
// Provenance: Energex Network Tariff Guide / published NUOS schedule (2026-27), the same
// figures already encoded in src/core/tariff/energex.ts (verified against a real Origin
// invoice). QLD does NOT observe daylight saving, so local clock time == NEM time year-round
// and there is no seasonal ToU on these tariffs.

import type { NetworkTariffSchema } from "@/core/tariff/schema";

const ENERGEX_PROVENANCE = {
  source: "Energex Network Tariff Guide — published NUOS schedule",
  effectiveFrom: "2026-07-01",
  note: "Figures verified against a real Origin invoice; see src/core/tariff/energex.ts.",
};

/**
 * Energex 7200 — SAC Large TOU Demand & Energy (LV, >100 MWh/yr). Peak 5–8pm weekdays,
 * off-peak 11am–1pm daily, shoulder otherwise. Demand is the kW variant.
 */
export const ENERGEX_7200_SCHEMA: NetworkTariffSchema = {
  schemaVersion: 1,
  code: "7200",
  name: "Energex 7200 (SAC Large TOU)",
  network: "Energex",
  state: "QLD",
  currency: "AUD",
  voltageClass: "LV",
  eligibility: { minAnnualMwh: 100 },
  provenance: ENERGEX_PROVENANCE,
  seasons: [], // no seasonal differentiation in SE QLD
  containsPlaceholders: false,
  charges: [
    { kind: "standing", label: "Network fixed charge", ratePerDay: { amount: 9.257 } },
    {
      kind: "energy",
      label: "Network energy",
      direction: "import",
      scope: "main",
      rates: [
        {
          touId: "peak",
          label: "Peak (5–8pm weekdays)",
          dayTypes: ["weekday"],
          windows: [{ startMin: 17 * 60, endMin: 20 * 60 }],
          rate: { amount: 0.01876 },
        },
        {
          touId: "offpeak",
          label: "Off-peak (11am–1pm daily)",
          dayTypes: ["weekday", "weekend", "public-holiday"],
          windows: [{ startMin: 11 * 60, endMin: 13 * 60 }],
          rate: { amount: 0.01627 },
        },
        {
          touId: "shoulder",
          label: "Shoulder (all other times)",
          dayTypes: ["weekday", "weekend", "public-holiday"],
          rate: { amount: 0.02947 },
        },
      ],
    },
    {
      kind: "demand",
      label: "Network demand (peak)",
      unit: "kW",
      rate: { amount: 15.459 },
      reset: "monthly",
      aggregation: "max-interval",
      measurement: {
        dayTypes: ["weekday"],
        windows: [{ startMin: 17 * 60, endMin: 20 * 60 }],
      },
    },
    {
      kind: "demand",
      label: "Network demand (shoulder)",
      unit: "kW",
      rate: { amount: 4.08 },
      reset: "monthly",
      aggregation: "max-interval",
      measurement: { dayTypes: ["weekday", "weekend", "public-holiday"] },
    },
  ],
};

/**
 * Energex 7400 — 11kV TOU Demand (CAC HV). Flat network energy volume charge; a single kVA
 * peak-demand charge measured 9am–9pm weekdays; daily access + monthly connection-unit fixed.
 */
export const ENERGEX_7400_SCHEMA: NetworkTariffSchema = {
  schemaVersion: 1,
  code: "7400",
  name: "Energex 7400 (11kV TOU Demand)",
  network: "Energex",
  state: "QLD",
  currency: "AUD",
  voltageClass: "HV",
  provenance: ENERGEX_PROVENANCE,
  seasons: [],
  containsPlaceholders: false,
  charges: [
    { kind: "standing", label: "Network access (DUOS)", ratePerDay: { amount: 22.306 } },
    { kind: "standing", label: "Jurisdictional scheme (fixed)", ratePerDay: { amount: 0.573 } },
    { kind: "monthly_fixed", label: "DUOS connection unit charge", ratePerMonth: { amount: 1719.07 } },
    {
      kind: "energy",
      label: "Network volume (DUOS+TUOS+JS)",
      direction: "import",
      scope: "main",
      rates: [
        {
          touId: "flat",
          label: "Flat volume",
          dayTypes: ["weekday", "weekend", "public-holiday"],
          rate: { amount: 0.01974 },
        },
      ],
    },
    {
      kind: "demand",
      label: "Network peak demand (DUOS+TUOS)",
      unit: "kVA",
      rate: { amount: 11.011 },
      reset: "monthly",
      aggregation: "max-interval",
      measurement: {
        dayTypes: ["weekday"],
        windows: [{ startMin: 9 * 60, endMin: 21 * 60 }],
      },
    },
  ],
};
