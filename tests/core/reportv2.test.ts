import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import {
  analyseOperations,
  topDemandIntervals,
  powerFactorAtPeakDemand,
  scope2,
  emissionsAvoided,
  recommendSolar,
} from "@/core/analytics";
import {
  benchmarkRetailEnergyRate,
  compareRetailRate,
  powerFactorCorrectionCase,
} from "@/core/tariff";
import { sortSavings, totalAnnualSaving, type SavingsItem } from "@/core/report";

function e1(date: string, hhmm: string, kwh: number): AnalyticsReading {
  return { channel: "E1", intervalStart: `${date}T${hhmm}:00+10:00`, intervalLength: 30, value: kwh, unit: "kWh", quality: "actual" };
}
function q1(date: string, hhmm: string, kvarh: number): AnalyticsReading {
  return { channel: "Q1", intervalStart: `${date}T${hhmm}:00+10:00`, intervalLength: 30, value: kvarh, unit: "kVArh", quality: "actual" };
}

describe("analyseOperations", () => {
  // Mon–Sun: weekdays have a daytime peak + overnight base; weekend is low base only.
  const readings: AnalyticsReading[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = `2024-07-${String(d).padStart(2, "0")}`; // 1 Jul 2024 = Mon
    const weekend = d >= 6;
    for (let i = 0; i < 48; i++) {
      const hh = String(Math.floor(i / 2)).padStart(2, "0");
      const mm = i % 2 === 0 ? "00" : "30";
      const hour = i / 2;
      let kw = 10; // overnight/base
      if (!weekend && hour >= 9 && hour < 17) kw = 100; // business peak
      readings.push(e1(date, `${hh}:${mm}`, kw / 2)); // kWh in 30 min
    }
  }
  it("finds base load, weekend ratio and out-of-hours share", () => {
    const o = analyseOperations(readings);
    expect(o.baseLoadKw).toBeCloseTo(10, 0); // overnight ~10 kW
    expect(o.weekendFractionOfWeekday).toBeLessThan(1); // weekends lower
    expect(o.outOfHoursFraction).toBeGreaterThan(0);
    expect(o.outOfHoursFraction).toBeLessThan(1);
  });
});

describe("topDemandIntervals", () => {
  it("returns the highest-kW intervals", () => {
    const top = topDemandIntervals(
      [e1("2024-07-01", "10:00", 50), e1("2024-07-01", "11:00", 25), e1("2024-07-01", "12:00", 100)],
      2,
    );
    expect(top.map((t) => t.kw)).toEqual([200, 100]); // 100kWh->200kW, 50->100
  });
});

describe("powerFactorAtPeakDemand", () => {
  it("uses the max-kVA interval, not the average", () => {
    const r = powerFactorAtPeakDemand([
      e1("2024-07-01", "10:00", 30), q1("2024-07-01", "10:00", 40), // 60kW,80kVAr ->100kVA pf .6
      e1("2024-07-01", "17:00", 45), q1("2024-07-01", "17:00", 0),  // 90kW,0 ->90kVA pf 1
    ]);
    expect(r.kva).toBeCloseTo(100);
    expect(r.powerFactor).toBeCloseTo(0.6);
  });
});

describe("emissions", () => {
  it("computes location and market-based Scope 2", () => {
    const s = scope2(1_000_000, 0.71, 0.5);
    expect(s.locationTonnes).toBeCloseTo(710);
    expect(s.marketTonnes).toBeCloseTo(355);
    expect(emissionsAvoided(100_000, 0.71)).toBeCloseTo(71);
  });
});

describe("retail benchmark", () => {
  it("builds a benchmark rate and flags an above-market rate", () => {
    const benchmark = benchmarkRetailEnergyRate(120); // $120/MWh futures
    expect(benchmark).toBeGreaterThan(0.1);
    const c = compareRetailRate(0.2, benchmark, 1_000_000);
    expect(c.aboveBenchmark).toBe(true);
    expect(c.annualOpportunity).toBeCloseTo((0.2 - benchmark) * 1_000_000);
  });
  it("reports no opportunity when at/below benchmark", () => {
    const c = compareRetailRate(0.1, 0.15, 1_000_000);
    expect(c.annualOpportunity).toBe(0);
  });
});

describe("power factor correction case", () => {
  it("values correction on a kVA tariff", () => {
    const c = powerFactorCorrectionCase({ peakKw: 900, peakKva: 1000, currentPf: 0.9, targetPf: 0.95, demandRatePerKvaMonth: 11.011, kvaBilled: true });
    expect(c.applicable).toBe(true);
    expect(c.correctedKva).toBeCloseTo(947.37, 1);
    expect(c.annualSavingAud).toBeGreaterThan(0);
    expect(c.capacitorKvar).toBeGreaterThan(0);
  });
  it("returns not-applicable on a kW tariff", () => {
    const c = powerFactorCorrectionCase({ peakKw: 900, peakKva: 1000, currentPf: 0.9, targetPf: 0.95, demandRatePerKvaMonth: 0, kvaBilled: false });
    expect(c.applicable).toBe(false);
    expect(c.annualSavingAud).toBe(0);
  });
});

describe("solar v2", () => {
  const readings: AnalyticsReading[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = `2024-07-${String(d).padStart(2, "0")}`;
    for (let i = 0; i < 48; i++) {
      const hh = String(Math.floor(i / 2)).padStart(2, "0");
      const mm = i % 2 === 0 ? "00" : "30";
      readings.push(e1(date, `${hh}:${mm}`, 50)); // flat 100 kW
    }
  }
  it("recommends a size with payback and a degraded lifetime saving", () => {
    const rec = recommendSolar(readings, 0.12);
    expect(rec.recommendedKwp).toBeGreaterThan(0);
    expect(rec.simplePaybackYears).toBeGreaterThan(0);
    // 25 yrs with degradation < 25x year-1, but > year-1.
    expect(rec.lifetimeSavingAud).toBeGreaterThan(rec.annualSavingAud);
    expect(rec.lifetimeSavingAud).toBeLessThan(rec.annualSavingAud * rec.assumptions.systemLifeYears);
  });
});

describe("savings register", () => {
  it("sorts by saving and totals", () => {
    const items: SavingsItem[] = [
      { measure: "Solar", annualSavingAud: 18000, indicativeCapexAud: 70000, paybackYears: 3.9, confidence: "medium" },
      { measure: "Retail re-tender", annualSavingAud: 36000, indicativeCapexAud: 0, paybackYears: 0, confidence: "low" },
    ];
    const sorted = sortSavings(items);
    expect(sorted[0].measure).toBe("Retail re-tender");
    expect(totalAnnualSaving(items)).toBe(54000);
  });
});
