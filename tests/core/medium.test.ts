import { describe, it, expect } from "vitest";
import { preIssueChecks } from "@/core/report";
import type { AnalyticsReading } from "@/core/analytics";
import { recommendSolar } from "@/core/analytics";

const OK = {
  lossesEntered: true,
  connectionVoltageSet: true,
  retailPlanCustom: true,
  retailDailyChargeTotal: 3.2,
  assumedPf: null,
  hasReactive: true,
  kvaBilled: true,
  peakKw: 200,
  connectionUnitChargeUnset: false,
};

describe("preIssueChecks (input/plausibility gate)", () => {
  it("passes a complete, plausible input set", () => {
    expect(preIssueChecks(OK)).toEqual([]);
  });
  it("blocks on missing loss factors", () => {
    const checks = preIssueChecks({ ...OK, lossesEntered: false });
    expect(checks.some((c) => c.level === "block" && /loss factor/i.test(c.message))).toBe(true);
  });
  it("blocks a kVA tariff with no reactive data and no assumed PF", () => {
    const checks = preIssueChecks({ ...OK, hasReactive: false, assumedPf: null });
    expect(checks.some((c) => c.level === "block" && /kVA/.test(c.message))).toBe(true);
  });
  it("blocks an out-of-range assumed PF and zero demand", () => {
    expect(preIssueChecks({ ...OK, hasReactive: false, assumedPf: 1.4 }).some((c) => c.level === "block")).toBe(true);
    expect(preIssueChecks({ ...OK, peakKw: 0 }).some((c) => c.level === "block")).toBe(true);
  });
  it("blocks when a connection-unit charge has no unit count set", () => {
    const checks = preIssueChecks({ ...OK, connectionUnitChargeUnset: true });
    expect(checks.some((c) => c.level === "block" && /connection.unit/i.test(c.message))).toBe(true);
  });
  it("flags an implausibly low retail supply/metering charge", () => {
    const checks = preIssueChecks({ ...OK, retailDailyChargeTotal: 0.03 });
    expect(checks.some((c) => c.level === "flag" && /implausibly low/.test(c.message))).toBe(true);
  });
  it("flags missing voltage and default retail plan (non-blocking)", () => {
    const checks = preIssueChecks({ ...OK, connectionVoltageSet: false, retailPlanCustom: false });
    expect(checks.every((c) => c.level === "flag")).toBe(true);
    expect(checks).toHaveLength(2);
  });
});

describe("solar export valuation + transparency", () => {
  // A daytime-heavy load so a larger system exports.
  const readings: AnalyticsReading[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = `2024-07-${String(d).padStart(2, "0")}`;
    for (let i = 0; i < 48; i++) {
      const hh = String(Math.floor(i / 2)).padStart(2, "0");
      const mm = i % 2 === 0 ? "00" : "30";
      readings.push({ channel: "E1", intervalStart: `${date}T${hh}:${mm}:00+10:00`, intervalLength: 30, value: i >= 16 && i < 36 ? 50 : 5, unit: "kWh", quality: "actual" });
    }
  }
  it("exposes the self-consumption / export split for both sizes", () => {
    const rec = recommendSolar(readings, 0.12);
    for (const o of [rec, rec.maxValue]) {
      expect(o.selfConsumedKwh).toBeGreaterThan(0);
      expect(o.exportedKwh).toBeGreaterThanOrEqual(0);
      expect(o.selfConsumptionPct).toBeGreaterThan(0);
      expect(o.selfConsumptionPct).toBeLessThanOrEqual(1);
    }
  });
  it("values exported kWh at the feed-in tariff (higher FiT => higher saving when exporting)", () => {
    const low = recommendSolar(readings, 0.12, { feedInTariffPerKwh: 0.0 });
    const high = recommendSolar(readings, 0.12, { feedInTariffPerKwh: 0.10 });
    // For the same max-value size, exporting more value with a higher FiT.
    if (high.maxValue.exportedKwh > 0) {
      expect(high.maxValue.annualSavingAud).toBeGreaterThan(low.maxValue.annualSavingAud);
    }
  });
});
