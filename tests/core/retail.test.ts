import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import {
  computeRetailCost,
  computeFullCost,
  retailMarginalPeakRate,
  DEFAULT_RETAIL_PLAN,
  ENERGEX_7400,
  type RetailPlan,
} from "@/core/tariff";

const MON = "2024-07-01"; // Monday

function e1(hhmm: string, kwh: number): AnalyticsReading {
  return { channel: "E1", intervalStart: `${MON}T${hhmm}:00+10:00`, intervalLength: 30, value: kwh, unit: "kWh", quality: "actual" };
}

const PLAN: RetailPlan = {
  label: "Test",
  peakRatePerKwh: 0.1,
  offpeakRatePerKwh: 0.2,
  peakWindow: { dayTypes: ["weekday"], ranges: [{ startMin: 7 * 60, endMin: 21 * 60 }] },
  environmentalPerKwh: 0.01,
  marketPerKwh: 0.002,
  supplyPerDay: 1,
  meteringPerDay: 3,
  estimated: false,
};

describe("computeRetailCost", () => {
  it("prices energy by the retail peak window plus per-kWh and daily charges", () => {
    const c = computeRetailCost(
      [e1("10:00", 100), e1("23:00", 50)], // 100 in peak (7-21), 50 off-peak
      PLAN,
    );
    const amt = (label: string) => c.lines.find((l) => l.label === label)!.amount;
    expect(amt("Retail energy (peak)")).toBeCloseTo(10); // 100 * 0.1
    expect(amt("Retail energy (off-peak)")).toBeCloseTo(10); // 50 * 0.2
    expect(amt("Environmental (SREC + LREC)")).toBeCloseTo(1.5); // 150 * 0.01
    expect(amt("Retail supply")).toBeCloseTo(1); // 1 day
    expect(amt("Metering")).toBeCloseTo(3);
    expect(c.total).toBeCloseTo(10 + 10 + 1.5 + 0.3 + 1 + 3);
  });

  it("applies loss factors to energy/environmental", () => {
    const c = computeRetailCost([e1("10:00", 100)], PLAN, { mlf: 1.01, dlf: 1.04 });
    expect(c.lines.find((l) => l.label === "Retail energy (peak)")!.amount).toBeCloseTo(100 * 0.1 * 1.01 * 1.04);
  });
});

describe("computeFullCost", () => {
  it("combines network tariff with the NMI retail plan", () => {
    const readings = [e1("10:00", 100)];
    const full = computeFullCost(readings, ENERGEX_7400, PLAN);
    expect(full.networkTotal).toBeGreaterThan(0);
    expect(full.retailTotal).toBeGreaterThan(0);
    expect(full.total).toBeCloseTo(full.networkTotal + full.retailTotal);
    // lines include both network and retail
    expect(full.lines.some((l) => l.category === "network")).toBe(true);
    expect(full.lines.some((l) => l.category === "retail")).toBe(true);
  });
});

describe("retailMarginalPeakRate", () => {
  it("sums the daytime per-kWh value of a self-consumed kWh", () => {
    expect(retailMarginalPeakRate(PLAN)).toBeCloseTo(0.1 + 0.01 + 0.002);
    expect(DEFAULT_RETAIL_PLAN.estimated).toBe(true);
  });
});
