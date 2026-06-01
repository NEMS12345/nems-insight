import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import { loadFactor, recommendSolar } from "@/core/analytics";
import { compareTariffs, ENERGEX_7200, ENERGEX_7400 } from "@/core/tariff";

function e1(date: string, hhmm: string, kwh: number): AnalyticsReading {
  return { channel: "E1", intervalStart: `${date}T${hhmm}:00+10:00`, intervalLength: 30, value: kwh, unit: "kWh", quality: "actual" };
}

describe("loadFactor", () => {
  it("is average demand over peak demand", () => {
    // 17:00 -> 10kW (5kWh), 17:30 -> 4kW (2kWh): avg 7kW, peak 10kW => 0.7
    const lf = loadFactor([e1("2024-07-01", "17:00", 5), e1("2024-07-01", "17:30", 2)]);
    expect(lf).toBeCloseTo(0.7);
  });
});

describe("compareTariffs", () => {
  it("ranks tariffs cheapest-first for the same data", () => {
    const readings = [e1("2024-07-01", "12:00", 100), e1("2024-07-01", "17:30", 50)];
    const ranked = compareTariffs(readings, [ENERGEX_7200, ENERGEX_7400]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].cost.total).toBeLessThanOrEqual(ranked[1].cost.total);
  });
});

describe("recommendSolar", () => {
  // A flat 100 kW daytime load every weekday interval for a week.
  const readings: AnalyticsReading[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = `2024-07-${String(d).padStart(2, "0")}`;
    for (let i = 0; i < 48; i++) {
      const hh = String(Math.floor(i / 2)).padStart(2, "0");
      const mm = i % 2 === 0 ? "00" : "30";
      readings.push(e1(date, `${hh}:${mm}`, 50)); // 50 kWh/30min = 100 kW
    }
  }

  it("sizes to daytime load, keeps export low, and computes payback", () => {
    const rec = recommendSolar(readings, 0.12); // 12c/kWh avoided
    // P10 of a flat 100 kW daytime load is 100 kW.
    expect(rec.recommendedKwp).toBe(100);
    expect(rec.annualGenerationKwh).toBeGreaterThan(0);
    expect(rec.selfConsumptionPct).toBeGreaterThan(0.9); // sized below load => minimal export
    expect(rec.annualSavingAud).toBeGreaterThan(0);
    expect(rec.simplePaybackYears).toBeGreaterThan(0);
    expect(rec.co2OffsetTonnes).toBeGreaterThan(0);
  });

  it("returns no payback when there is no avoided cost", () => {
    expect(recommendSolar(readings, 0).simplePaybackYears).toBeNull();
  });
});
