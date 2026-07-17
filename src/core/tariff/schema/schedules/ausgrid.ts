// Ausgrid (NSW) — STRUCTURE-ONLY fixture. This exists to PROVE the schema can express a
// different DNSP's shape (NSW observes daylight saving, and Ausgrid runs SEASONAL time-of-use
// with a demand ratchet). The rate AMOUNTS are deliberate placeholders — NOT authoritative
// pricing. Each carries a TODO naming the published schedule the real figure must come from.
//
// Before this tariff is ever used for costing: populate the NSW public-holiday calendar
// (src/core/tariff/schema/holidays.ts) and replace every placeholder amount with the real
// figure from the cited Ausgrid schedule, then set containsPlaceholders: false.

import type { NetworkTariffSchema } from "@/core/tariff/schema";

const TODO_AUSGRID = "Ausgrid published Network Price List (EA116 LV demand), effective 2024-07-01";

/**
 * Ausgrid EA225-style LV TOU + demand (illustrative structure). Summer (Nov–Mar) and
 * non-summer peak windows differ — that's the seasonal ToU this fixture demonstrates. Demand
 * is kVA with a 12-month, 50%-of-peak ratchet.
 */
export const AUSGRID_LV_DEMAND_SCHEMA: NetworkTariffSchema = {
  schemaVersion: 1,
  code: "AUSGRID-LV-DEMAND",
  name: "Ausgrid LV TOU Demand (STRUCTURE-ONLY fixture)",
  network: "Ausgrid",
  state: "NSW",
  currency: "AUD",
  voltageClass: "LV",
  provenance: {
    source: "STRUCTURE-ONLY fixture — figures are placeholders, not Ausgrid pricing",
    effectiveFrom: "2024-07-01",
    note: "Replace placeholder amounts with real Ausgrid schedule figures before costing.",
  },
  containsPlaceholders: true,
  seasons: [
    { id: "summer", label: "Summer (Nov–Mar)", monthRanges: [{ fromMonth: 11, toMonth: 3 }] },
    { id: "non-summer", label: "Non-summer (Apr–Oct)", monthRanges: [{ fromMonth: 4, toMonth: 10 }] },
  ],
  charges: [
    {
      kind: "standing",
      label: "Network access charge",
      ratePerDay: { amount: 0, placeholder: true, todo: TODO_AUSGRID },
    },
    {
      kind: "energy",
      label: "Network energy (seasonal ToU)",
      direction: "import",
      scope: "main",
      rates: [
        // Summer peak is a longer afternoon/evening window than non-summer.
        {
          touId: "peak",
          label: "Summer peak (2–8pm weekdays)",
          dayTypes: ["weekday"],
          seasonId: "summer",
          windows: [{ startMin: 14 * 60, endMin: 20 * 60 }],
          rate: { amount: 0, placeholder: true, todo: TODO_AUSGRID },
        },
        {
          touId: "peak",
          label: "Non-summer peak (5–9pm weekdays)",
          dayTypes: ["weekday"],
          seasonId: "non-summer",
          windows: [{ startMin: 17 * 60, endMin: 21 * 60 }],
          rate: { amount: 0, placeholder: true, todo: TODO_AUSGRID },
        },
        {
          touId: "shoulder",
          label: "Shoulder",
          dayTypes: ["weekday"],
          windows: [
            { startMin: 7 * 60, endMin: 14 * 60 },
            { startMin: 20 * 60, endMin: 22 * 60 },
          ],
          rate: { amount: 0, placeholder: true, todo: TODO_AUSGRID },
        },
        {
          touId: "offpeak",
          label: "Off-peak (overnight, weekends & public holidays)",
          dayTypes: ["weekday", "weekend", "public-holiday"],
          windows: [
            { startMin: 0, endMin: 7 * 60 },
            { startMin: 22 * 60, endMin: 24 * 60 },
          ],
          rate: { amount: 0, placeholder: true, todo: TODO_AUSGRID },
        },
      ],
    },
    {
      kind: "energy",
      label: "Controlled load (separate tariff)",
      direction: "import",
      scope: "controlled-load",
      rates: [
        {
          touId: "flat",
          label: "Controlled load flat",
          dayTypes: ["weekday", "weekend", "public-holiday"],
          rate: { amount: 0, placeholder: true, todo: TODO_AUSGRID },
        },
      ],
    },
    {
      kind: "demand",
      label: "Network demand (kVA, ratcheted)",
      unit: "kVA",
      rate: { amount: 0, placeholder: true, todo: TODO_AUSGRID },
      reset: "monthly",
      aggregation: "max-interval",
      measurement: {
        dayTypes: ["weekday"],
        windows: [{ startMin: 14 * 60, endMin: 20 * 60 }],
      },
      ratchet: { percentOfPeak: 50, lookbackMonths: 12 },
    },
  ],
};
