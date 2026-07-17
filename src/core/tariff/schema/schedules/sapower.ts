// SA Power Networks (SA) — STRUCTURE-ONLY fixture. A second non-Energex shape to prove the
// schema generalises: SA observes daylight saving, and this illustrates STEPPED (block)
// energy rates plus an annual demand reset. The rate AMOUNTS are placeholders — NOT
// authoritative pricing — each tagged with a TODO naming the published schedule.
//
// Before costing: populate the SA public-holiday calendar (holidays.ts) and replace every
// placeholder amount from the cited SA Power Networks schedule, then set
// containsPlaceholders: false.

import type { NetworkTariffSchema } from "@/core/tariff/schema";

const TODO_SAPN = "SA Power Networks Annual Tariff Schedule (business TOU), effective 2024-07-01";

/**
 * SA Power Networks business TOU with stepped energy and annual-reset demand (illustrative
 * structure). The stepped block (first 10,000 kWh/month, then the balance) demonstrates the
 * schema's block/step support; demand resets annually rather than monthly.
 */
export const SAPN_BUSINESS_TOU_SCHEMA: NetworkTariffSchema = {
  schemaVersion: 1,
  code: "SAPN-BUSINESS-TOU",
  name: "SA Power Networks Business TOU (STRUCTURE-ONLY fixture)",
  network: "SA Power Networks",
  state: "SA",
  currency: "AUD",
  voltageClass: "LV",
  provenance: {
    source: "STRUCTURE-ONLY fixture — figures are placeholders, not SA Power Networks pricing",
    effectiveFrom: "2024-07-01",
    note: "Replace placeholder amounts with real SAPN schedule figures before costing.",
  },
  containsPlaceholders: true,
  seasons: [
    { id: "summer", label: "Summer (Dec–Feb)", monthRanges: [{ fromMonth: 12, toMonth: 2 }] },
  ],
  charges: [
    {
      kind: "standing",
      label: "Supply charge",
      ratePerDay: { amount: 0, placeholder: true, todo: TODO_SAPN },
    },
    {
      kind: "energy",
      label: "Network energy (stepped/block, ToU)",
      direction: "import",
      scope: "main",
      blockReset: "monthly",
      rates: [
        {
          touId: "peak",
          label: "Summer peak (10am–8pm weekdays) — stepped",
          dayTypes: ["weekday"],
          seasonId: "summer",
          windows: [{ startMin: 10 * 60, endMin: 20 * 60 }],
          // `rate` is ignored when `blocks` present, but kept for shape; both placeholders.
          rate: { amount: 0, placeholder: true, todo: TODO_SAPN },
          blocks: [
            { uptoKwh: 10000, rate: { amount: 0, placeholder: true, todo: TODO_SAPN } },
            { uptoKwh: null, rate: { amount: 0, placeholder: true, todo: TODO_SAPN } },
          ],
        },
        {
          touId: "offpeak",
          label: "Off-peak (all other times, weekends & public holidays)",
          dayTypes: ["weekday", "weekend", "public-holiday"],
          rate: { amount: 0, placeholder: true, todo: TODO_SAPN },
        },
      ],
    },
    {
      kind: "energy",
      label: "Solar export (feed-in)",
      direction: "export",
      scope: "main",
      rates: [
        {
          touId: "flat",
          label: "Export flat",
          dayTypes: ["weekday", "weekend", "public-holiday"],
          rate: { amount: 0, placeholder: true, todo: TODO_SAPN },
        },
      ],
    },
    {
      kind: "demand",
      label: "Network demand (kW, annual reset)",
      unit: "kW",
      rate: { amount: 0, placeholder: true, todo: TODO_SAPN },
      reset: "annual",
      aggregation: "max-interval",
      measurement: {
        dayTypes: ["weekday"],
        seasonId: "summer",
        windows: [{ startMin: 10 * 60, endMin: 20 * 60 }],
      },
    },
  ],
};
