import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import { computeFullCost, ENERGEX_7400, DEFAULT_RETAIL_PLAN } from "@/core/tariff";

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN / CHARACTERISATION TEST — Energex 7400 (11kV TOU Demand) + Origin retail.
//
// This pins the cost engine's output, line by line, to the cent, against a LITERAL copy of
// the rates that were derived from the real Origin/Energex invoice (energex.ts / retail.ts).
// The rate numbers below are deliberately re-typed (not imported) so that if a rate in the
// source code is ever changed, the engine's output diverges from this copy and the test fails
// — exactly the regression guard that was missing.
//
// What it proves today: the engine reproduces every charge to the cent for a fully-specified
// period, and the loss-factor discipline holds (network volume = no losses; retail energy =
// MLF×DLF; environmental/market = DLF only).
//
// To upgrade it to a STRICT source-of-truth check against the actual invoice, replace the
// synthetic constant-load fixture with the invoice period's real interval data, and replace
// the EXPECTED_* literals below with the dollar figures printed on the invoice. The
// shape-INDEPENDENT lines (daily supply, monthly connection, network volume, environmental,
// market, supply, metering) should then match the invoice exactly; the shape-DEPENDENT lines
// (retail energy by ToU, demand) track the actual load shape.
// ─────────────────────────────────────────────────────────────────────────────

// Rates re-typed from the invoice-derived source (see energex.ts / retail.ts).
const R = {
  duosDaily: 22.306, // Network access (DUOS), $/day
  jsDaily: 0.573, // Jurisdictional scheme (fixed), $/day
  connectionMonthly: 1719.07, // DUOS connection unit charge, $/month
  networkVolume: 0.01974, // Network volume (DUOS+TUOS+JS), $/kWh, NO loss factors
  demandKva: 11.011, // Network peak demand (DUOS+TUOS), $/kVA/month
  retailPeak: 0.072713, // $/kWh
  retailOffpeak: 0.093965, // $/kWh
  environmental: 0.010786, // $/kWh, DLF only
  market: 0.001261, // $/kWh, DLF only
  retailSupply: 0.032437, // $/day
  metering: 3.232876, // $/day (2 meters)
} as const;

// Loss factors for this fixture (exercise the loss discipline; not the invoice's own values).
const MLF = 0.99;
const DLF = 1.04;
const ENERGY_LOSS = MLF * DLF; // applied to retail energy only

// Fixture: a constant load across the whole of July 2024, so every quantity is exact and
// hand-derivable. Each 30-minute interval carries E1 = 50 kWh (→ 100 kW) and Q1 = 37.5 kVArh
// (→ 75 kVAr), giving a constant 125 kVA (pf 0.8).
const YEAR_MONTH = "2024-07";
const DAYS_IN_MONTH = 31;
const INTERVALS_PER_DAY = 48;
const E1_PER_INTERVAL = 50;
const Q1_PER_INTERVAL = 37.5;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function buildJuly2024(): AnalyticsReading[] {
  const out: AnalyticsReading[] = [];
  for (let day = 1; day <= DAYS_IN_MONTH; day++) {
    const date = `${YEAR_MONTH}-${pad(day)}`;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const minute = i * 30;
      const start = `${date}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:00+10:00`;
      out.push({ channel: "E1", intervalStart: start, intervalLength: 30, value: E1_PER_INTERVAL, unit: "kWh", quality: "actual" });
      out.push({ channel: "Q1", intervalStart: start, intervalLength: 30, value: Q1_PER_INTERVAL, unit: "kVArh", quality: "actual" });
    }
  }
  return out;
}

// Derived quantities (all exact for the constant-load fixture):
const TOTAL_KWH = DAYS_IN_MONTH * INTERVALS_PER_DAY * E1_PER_INTERVAL; // 74,400 kWh
// July 2024: 1 Jul is a Monday → 23 weekdays, 8 weekend days.
const WEEKDAYS = 23;
// Retail peak window is 7am–9pm weekday = 28 intervals/day.
const PEAK_KWH = WEEKDAYS * 28 * E1_PER_INTERVAL; // 32,200 kWh
const OFFPEAK_KWH = TOTAL_KWH - PEAK_KWH; // 42,200 kWh
const DEMAND_KVA = Math.sqrt(100 * 100 + 75 * 75); // 125 kVA, constant in any window

describe("golden invoice — Energex 7400 + Origin retail, July 2024 constant load", () => {
  const cost = computeFullCost(buildJuly2024(), ENERGEX_7400, DEFAULT_RETAIL_PLAN, { mlf: MLF, dlf: DLF });
  const amt = (label: string): number => {
    const line = cost.lines.find((l) => l.label === label);
    if (!line) throw new Error(`missing cost line: ${label}`);
    return line.amount;
  };

  it("derives the right quantities from the fixture", () => {
    expect(TOTAL_KWH).toBe(74400);
    expect(PEAK_KWH).toBe(32200);
    expect(OFFPEAK_KWH).toBe(42200);
    expect(DEMAND_KVA).toBe(125);
  });

  // Shape-INDEPENDENT charges — these would reproduce the invoice to the cent for any load
  // with the same totals, days and months.
  it("network access (DUOS) daily charge", () => {
    expect(amt("Network access (DUOS)")).toBeCloseTo(R.duosDaily * DAYS_IN_MONTH, 2); // 691.486
  });
  it("jurisdictional scheme daily charge", () => {
    expect(amt("Jurisdictional scheme (fixed)")).toBeCloseTo(R.jsDaily * DAYS_IN_MONTH, 2); // 17.763
  });
  it("DUOS connection unit (monthly) charge", () => {
    expect(amt("DUOS connection unit charge")).toBeCloseTo(R.connectionMonthly * 1, 2); // 1719.07
  });
  it("network volume — flat, NO loss factors", () => {
    expect(amt("Network volume (DUOS+TUOS+JS)")).toBeCloseTo(R.networkVolume * TOTAL_KWH, 2); // 1468.656
  });
  it("environmental — DLF only", () => {
    expect(amt("Environmental (SREC + LREC)")).toBeCloseTo(R.environmental * TOTAL_KWH * DLF, 2);
  });
  it("regulated / market — DLF only", () => {
    expect(amt("Regulated / market (AEMO)")).toBeCloseTo(R.market * TOTAL_KWH * DLF, 2);
  });
  it("retail supply daily charge", () => {
    expect(amt("Retail supply")).toBeCloseTo(R.retailSupply * DAYS_IN_MONTH, 2);
  });
  it("metering daily charge", () => {
    expect(amt("Metering")).toBeCloseTo(R.metering * DAYS_IN_MONTH, 2); // 100.219156
  });

  // Shape-DEPENDENT charges — exact for this fixture; track the load shape on a real invoice.
  it("retail energy (peak) — MLF×DLF", () => {
    expect(amt("Retail energy (peak)")).toBeCloseTo(PEAK_KWH * R.retailPeak * ENERGY_LOSS, 2);
  });
  it("retail energy (off-peak) — MLF×DLF", () => {
    expect(amt("Retail energy (off-peak)")).toBeCloseTo(OFFPEAK_KWH * R.retailOffpeak * ENERGY_LOSS, 2);
  });
  it("network peak demand — monthly max kVA", () => {
    expect(amt("Network peak demand (DUOS+TUOS)")).toBeCloseTo(R.demandKva * DEMAND_KVA, 2); // 1376.375
  });

  // Totals.
  it("network, retail and grand totals reconcile to the cent", () => {
    const expectedNetwork =
      R.duosDaily * DAYS_IN_MONTH +
      R.jsDaily * DAYS_IN_MONTH +
      R.connectionMonthly +
      R.networkVolume * TOTAL_KWH +
      R.demandKva * DEMAND_KVA;
    const expectedRetail =
      PEAK_KWH * R.retailPeak * ENERGY_LOSS +
      OFFPEAK_KWH * R.retailOffpeak * ENERGY_LOSS +
      R.environmental * TOTAL_KWH * DLF +
      R.market * TOTAL_KWH * DLF +
      R.retailSupply * DAYS_IN_MONTH +
      R.metering * DAYS_IN_MONTH;

    expect(cost.networkTotal).toBeCloseTo(expectedNetwork, 2); // 5273.35
    expect(cost.retailTotal).toBeCloseTo(expectedRetail, 2);
    expect(cost.total).toBeCloseTo(expectedNetwork + expectedRetail, 2);
  });
});
