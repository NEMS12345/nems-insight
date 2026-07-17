import { describe, expect, it } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import {
  computeVersionedFullCost,
  type RetailPlan,
  type Tariff,
} from "@/core/tariff";

const periods: Tariff["periods"] = {
  peak: { dayTypes: ["weekday"], ranges: [{ startMin: 0, endMin: 1440 }] },
  offpeak: { dayTypes: ["weekend"], ranges: [{ startMin: 0, endMin: 1440 }] },
};

function tariff(rate: number, demandRate: number, connectionRate: number): Tariff {
  return {
    code: "TEST",
    name: "Test tariff",
    network: "Energex",
    currency: "AUD",
    voltageClass: "LV",
    hasEstimatedCharges: false,
    periods,
    charges: [
      { kind: "energy", category: "network", label: "Energy", period: "all", rate },
      {
        kind: "demand_monthly",
        category: "network",
        label: "Demand",
        period: "peak",
        unit: "kW",
        rate: demandRate,
      },
      {
        kind: "connection_unit",
        category: "network",
        label: "Connection",
        ratePerUnit: connectionRate,
      },
    ],
  };
}

function retail(rate: number): RetailPlan {
  return {
    label: "Retail",
    peakRatePerKwh: rate,
    offpeakRatePerKwh: rate,
    peakWindow: { dayTypes: ["weekday", "weekend"], ranges: [{ startMin: 0, endMin: 1440 }] },
    environmentalPerKwh: 0,
    marketPerKwh: 0,
    supplyPerDay: 0,
    meteringPerDay: 0,
    estimated: false,
  };
}

function reading(date: string): AnalyticsReading {
  return {
    channel: "E1",
    intervalStart: `${date}T12:00:00+10:00`,
    intervalLength: 30,
    value: 2,
    unit: "kWh",
    quality: "actual",
  };
}

describe("computeVersionedFullCost", () => {
  it("prices each calendar month with its effective network and retail versions", () => {
    const result = computeVersionedFullCost(
      [reading("2026-06-30"), reading("2026-07-01")],
      [
        { start: "2026-06-30", end: "2026-06-30", rates: tariff(1, 10, 100) },
        { start: "2026-07-01", end: "2026-07-01", rates: tariff(2, 20, 200) },
      ],
      [
        { start: "2026-06-30", end: "2026-06-30", rates: retail(0.1) },
        { start: "2026-07-01", end: "2026-07-01", rates: retail(0.2) },
      ],
      { connectionUnits: 2 },
    );

    expect(result.lines.find((line) => line.label === "Energy")?.amount).toBe(6);
    expect(result.lines.find((line) => line.label === "Demand")?.amount).toBe(120);
    expect(result.lines.find((line) => line.label === "Connection")?.amount).toBe(300);
    expect(result.retailTotal).toBeCloseTo(0.6);
    expect(result.total).toBeCloseTo(426.6);
  });

  it("allows a retail-only change on any date", () => {
    expect(() =>
      computeVersionedFullCost(
        [reading("2026-07-14"), reading("2026-07-15")],
        [{ start: "2026-07-14", end: "2026-07-15", rates: tariff(1, 10, 100) }],
        [
          { start: "2026-07-14", end: "2026-07-14", rates: retail(0.1) },
          { start: "2026-07-15", end: "2026-07-15", rates: retail(0.2) },
        ],
      ),
    ).not.toThrow();
  });

  it("blocks an unsupported mid-month network-demand change", () => {
    expect(() =>
      computeVersionedFullCost(
        [reading("2026-07-14"), reading("2026-07-15")],
        [
          { start: "2026-07-14", end: "2026-07-14", rates: tariff(1, 10, 100) },
          { start: "2026-07-15", end: "2026-07-15", rates: tariff(2, 20, 200) },
        ],
        [{ start: "2026-07-14", end: "2026-07-15", rates: retail(0.1) }],
      ),
    ).toThrow("inside a demand month");
  });
});
