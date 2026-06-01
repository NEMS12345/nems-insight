import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import {
  analyseDataWindow,
  analyseOperations,
  scope3Electricity,
  ngaScope3Factor,
  recommendSolar,
} from "@/core/analytics";
import {
  demandShaveSaving,
  benchmarkRetailEnergyBand,
  type Tariff,
} from "@/core/tariff";
import { adjustConfidence } from "@/core/report";

function e1(date: string, hhmm: string, kwh: number): AnalyticsReading {
  return { channel: "E1", intervalStart: `${date}T${hhmm}:00+10:00`, intervalLength: 30, value: kwh, unit: "kWh", quality: "actual" };
}

describe("analyseDataWindow", () => {
  it("flags a partial-year window for seasonal caveat", () => {
    const w = analyseDataWindow([e1("2024-04-01", "12:00", 1), e1("2024-04-10", "12:00", 1)]);
    expect(w.spansFullYear).toBe(false);
    expect(w.seasonalCaveat).toBe(true);
    expect(w.annualisationFactor).toBeGreaterThan(1);
  });
});

describe("operations avoidable base load", () => {
  it("treats only the non-essential share as avoidable", () => {
    const readings: AnalyticsReading[] = [];
    for (let i = 0; i < 48; i++) {
      const hh = String(Math.floor(i / 2)).padStart(2, "0");
      const mm = i % 2 === 0 ? "00" : "30";
      readings.push(e1("2024-07-01", `${hh}:${mm}`, 10)); // flat 20 kW
    }
    const o = analyseOperations(readings, 0.6);
    expect(o.baseLoadKw).toBeCloseTo(20, 0);
    expect(o.avoidableBaseLoadKw).toBeCloseTo(8, 0); // 20 * (1 - 0.6)
    expect(o.outOfHoursTimeFraction).toBeGreaterThan(0);
  });
});

describe("scope 3 electricity", () => {
  it("computes T&D + upstream emissions", () => {
    expect(scope3Electricity(1_000_000, ngaScope3Factor("QLD"))).toBeCloseTo(110);
  });
});

describe("solar reports both min-payback and max-value sizes", () => {
  const readings: AnalyticsReading[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = `2024-07-${String(d).padStart(2, "0")}`;
    for (let i = 0; i < 48; i++) {
      const hh = String(Math.floor(i / 2)).padStart(2, "0");
      const mm = i % 2 === 0 ? "00" : "30";
      readings.push(e1(date, `${hh}:${mm}`, i >= 14 && i < 36 ? 100 : 20));
    }
  }
  it("exposes a maxValue option alongside the recommendation", () => {
    const rec = recommendSolar(readings, 0.12);
    expect(rec.recommendedKwp).toBeGreaterThan(0);
    expect(rec.maxValue.kwp).toBeGreaterThan(0);
    expect(rec.maxValue.lifetimeSavingAud).toBeGreaterThanOrEqual(rec.lifetimeSavingAud);
  });
});

describe("demandShaveSaving", () => {
  const tariff: Tariff = {
    code: "T", name: "t", network: "Energex", currency: "AUD", voltageClass: "LV", hasEstimatedCharges: false,
    periods: { peak: { dayTypes: ["weekday"], ranges: [{ startMin: 0, endMin: 1440 }] }, offpeak: { dayTypes: [], ranges: [] } },
    charges: [{ kind: "demand_monthly", category: "network", label: "d", period: "peak", unit: "kW", rate: 10 }],
  };
  it("clips each month's top interval to the second-highest", () => {
    const s = demandShaveSaving([e1("2024-07-01", "17:00", 100), e1("2024-07-01", "17:30", 70)], tariff);
    // 200kW vs 140kW => 60kW shave * $10 = $600/month * 12 = $7200/yr
    expect(s.unit).toBe("kW");
    expect(s.theoreticalAnnualSaving).toBeCloseTo(7200);
  });
});

describe("benchmark band & confidence", () => {
  it("returns a low/mid/high band", () => {
    const b = benchmarkRetailEnergyBand(120, {}, 0.1);
    expect(b.low).toBeLessThan(b.mid);
    expect(b.high).toBeGreaterThan(b.mid);
  });
  it("downgrades confidence on weak data", () => {
    expect(adjustConfidence("high", { seasonalCaveat: true, estimatedFraction: 0 })).toBe("medium");
    expect(adjustConfidence("high", { seasonalCaveat: true, estimatedFraction: 0.2 })).toBe("low");
  });
});
