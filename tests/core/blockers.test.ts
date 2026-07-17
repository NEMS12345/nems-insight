import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import { hasReactiveData, powerFactorAtPeakDemand } from "@/core/analytics";
import {
  eligibleTariffs,
  assessRetail,
  computeCost,
  ENERGEX_7200,
  ENERGEX_7400,
  type Tariff,
} from "@/core/tariff";

function e1(hhmm: string, kwh: number): AnalyticsReading {
  return { channel: "E1", intervalStart: `2024-07-01T${hhmm}:00+10:00`, intervalLength: 30, value: kwh, unit: "kWh", quality: "actual" };
}
function q1(hhmm: string, kvarh: number): AnalyticsReading {
  return { channel: "Q1", intervalStart: `2024-07-01T${hhmm}:00+10:00`, intervalLength: 30, value: kvarh, unit: "kVArh", quality: "actual" };
}

const ALL = [ENERGEX_7200, ENERGEX_7400];

describe("BLOCKER 1 — tariff eligibility", () => {
  it("never offers an HV tariff to an LV NMI", () => {
    const { tariffs } = eligibleTariffs(ALL, { connectionVoltage: "LV", currentCode: "7200", annualMwh: 200 });
    expect(tariffs.map((t) => t.code)).toContain("7200");
    expect(tariffs.map((t) => t.code)).not.toContain("7400");
  });
  it("offers HV tariffs to an HV NMI", () => {
    const { tariffs } = eligibleTariffs(ALL, { connectionVoltage: "HV", currentCode: "7400", annualMwh: 200 });
    expect(tariffs.map((t) => t.code)).toContain("7400");
    expect(tariffs.map((t) => t.code)).not.toContain("7200");
  });
  it("suppresses cross-voltage comparison when voltage is unknown", () => {
    const res = eligibleTariffs(ALL, { connectionVoltage: null, currentCode: "7200", annualMwh: 200 });
    expect(res.crossVoltageLimited).toBe(true);
    expect(res.tariffs.map((t) => t.code)).not.toContain("7400"); // limited to current (LV) class
  });
  it("always keeps the current tariff as the baseline", () => {
    const { tariffs } = eligibleTariffs(ALL, { connectionVoltage: "LV", currentCode: "7200", annualMwh: 5 });
    expect(tariffs.map((t) => t.code)).toContain("7200"); // even below its 100 MWh threshold
  });
});

describe("BLOCKER 3 — power factor / reactive detection", () => {
  it("detects absence of reactive data", () => {
    expect(hasReactiveData([e1("17:00", 5)])).toBe(false);
    expect(hasReactiveData([e1("17:00", 5), q1("17:00", 2)])).toBe(true);
  });
  it("never fabricates PF/kVA without reactive data", () => {
    const r = powerFactorAtPeakDemand([e1("17:00", 5)]);
    expect(r.powerFactor).toBeNull();
    expect(r.kva).toBeNull();
    expect(r.reactiveDataAvailable).toBe(false);
  });
  it("computes PF and kVA when reactive data is present", () => {
    const r = powerFactorAtPeakDemand([e1("17:00", 3), q1("17:00", 4)]); // 6kW,8kVAr=>10kVA, pf .6
    expect(r.kva).toBeCloseTo(10);
    expect(r.powerFactor).toBeCloseTo(0.6);
  });
  it("uses an assumed PF for kVA demand only when set; never assumes unity", () => {
    const kvaTariff: Tariff = {
      code: "K", name: "k", network: "Energex", currency: "AUD", voltageClass: "HV", hasEstimatedCharges: false,
      periods: { peak: { dayTypes: ["weekday"], ranges: [{ startMin: 0, endMin: 1440 }] }, offpeak: { dayTypes: [], ranges: [] } },
      charges: [{ kind: "demand_monthly", category: "network", label: "kVA", period: "peak", unit: "kVA", rate: 10 }],
    };
    const readings = [e1("17:00", 6)]; // 12 kW, no reactive
    const noPf = computeCost(readings, kvaTariff).lines[0].amount; // falls back to kW: 12*10
    const withPf = computeCost(readings, kvaTariff, { assumedPf: 0.9 }).lines[0].amount; // 12/0.9*10
    expect(noPf).toBeCloseTo(120);
    expect(withPf).toBeCloseTo((12 / 0.9) * 10);
  });
});

describe("BLOCKER 4 — retail verdict from numbers", () => {
  const band = { low: 0.1147, mid: 0.1275, high: 0.1402 };
  it("calls below-band favourable, not 'competitive'", () => {
    const a = assessRetail(0.0918, band, 1_000_000, 0.0931);
    expect(a.verdict).toBe("below-market");
    expect(a.annualOpportunity).toBe(0);
    expect(a.belowForward).toBe(true); // 9.18c < 9.31c forward
  });
  it("flags above-band with a re-tender opportunity", () => {
    const a = assessRetail(0.16, band, 1_000_000, 0.0931);
    expect(a.verdict).toBe("above-market");
    expect(a.annualOpportunity).toBeCloseTo((0.16 - band.high) * 1_000_000);
  });
  it("calls within-band in line with market", () => {
    expect(assessRetail(0.13, band, 1_000_000, 0.0931).verdict).toBe("in-line");
  });
});
