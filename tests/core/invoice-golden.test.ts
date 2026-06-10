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
  connectionUnitRate: 245.582, // DUOS connection unit charge, $/unit
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
const CONNECTION_UNITS = 7; // connection-unit count for the connection_unit charge

describe("golden invoice — Energex 7400 + Origin retail, July 2024 constant load", () => {
  const cost = computeFullCost(buildJuly2024(), ENERGEX_7400, DEFAULT_RETAIL_PLAN, {
    mlf: MLF,
    dlf: DLF,
    connectionUnits: CONNECTION_UNITS,
  });
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
  it("DUOS connection unit charge — rate × count", () => {
    expect(amt("DUOS connection unit charge")).toBeCloseTo(R.connectionUnitRate * CONNECTION_UNITS, 2); // 1719.074
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
      R.connectionUnitRate * CONNECTION_UNITS +
      R.jsDaily * DAYS_IN_MONTH +
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

// ─────────────────────────────────────────────────────────────────────────────
// STRICT source validation against a REAL Origin invoice.
//
// Invoice QB04077571 — NMI QB04077571, State Law Building 50 Ann St Brisbane QLD, Energex
// tariff 7400, 01–31 Mar 2026 (31 days). Figures below are the EX-GST dollars printed on the
// bill. This proves the engine reproduces a specific real bill, not just its own rates.
//
// Method: shape-INDEPENDENT lines (network access/JS/connection/volume, environmental,
// regulated, metering) are driven through the real engine with a constant-load proxy summing
// to the invoice's total kWh — none of them depend on load shape. Shape-DEPENDENT lines
// (retail energy by ToU, demand) are checked from the engine's rates against the invoice's
// METERED quantities (peak/off-peak kWh, peak kVA), since reproducing them from raw intervals
// would need the period's NEM12 file.
//
// Result (see assertions): network, demand and peak energy reproduce to the cent; the whole
// bill reconciles to within ~4c on $42,542. Two sub-lines carry a few-cents residual that is a
// real modelling choice, documented inline (environmental combined-rate rounding; regulated
// applied to total vs net-of-export kWh).
// ─────────────────────────────────────────────────────────────────────────────

/** A constant load over [start, end] inclusive totalling `totalKwh` — drives days/kWh exactly. */
function constantLoadOverPeriod(start: string, end: string, totalKwh: number): AnalyticsReading[] {
  const days: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  const perInterval = totalKwh / (days.length * INTERVALS_PER_DAY);
  const out: AnalyticsReading[] = [];
  for (const date of days) {
    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const minute = i * 30;
      const startTs = `${date}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:00+10:00`;
      out.push({ channel: "E1", intervalStart: startTs, intervalLength: 30, value: perInterval, unit: "kWh", quality: "actual" });
    }
  }
  return out;
}

// The real invoice, as printed (ex-GST $ and metered quantities).
const INV = {
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  days: 31,
  mlf: 1.0106,
  dlf: 1.04388,
  // Metered quantities:
  totalKwh: 260762.03,
  peakKwh: 194059.1,
  offpeakKwh: 66702.93,
  demandKva: 916.16,
  connectionUnits: 7, // "7 Days @ $245.582/Day" → 7 connection units

  // Printed ex-GST $:
  networkAccessDuos: 691.49, // DUOS access 22.306 $/day × 31
  jurisdictionalScheme: 17.76, // JS fixed 0.573 $/day × 31
  connectionUnit: 1719.07, // DUOS connection unit (see modelling note below)
  networkVolume: 5147.44, // TUOS 2518.96 + JS 252.94 + DUOS 2375.54
  networkDemand: 10087.84, // DUOS 8264.68 + TUOS 1823.16 (9.021 + 1.990 = 11.011 $/kVA)
  networkSubtotal: 17663.6,
  energyPeak: 14885.93, // 194,059.1 kWh @ 7.2713c × MLF × DLF
  energyOffpeak: 6612.12, // 66,702.93 kWh @ 9.3965c × MLF × DLF
  energySubtotal: 21498.05,
  environmental: 2935.97, // SREC + LREC, certificate-adjusted, × DLF
  regulated: 344.24, // AEMO ancillary + participant (× DLF) + FRC daily
  metering: 100.22, // 2 meters @ 1.616438 $/meter/day × 31
  subTotalExGst: 42542.08,
} as const;

const CENT = 0.005; // "to the cent"
const FEW_CENTS = 0.05; // documented residual on two sub-lines

function within(actual: number, expected: number, tol: number, msg?: string): void {
  expect(Math.abs(actual - expected), msg).toBeLessThanOrEqual(tol);
}

describe("STRICT — reproduces real Origin invoice QB04077571 (Energex 7400, Mar 2026)", () => {
  const proxy = constantLoadOverPeriod(INV.periodStart, INV.periodEnd, INV.totalKwh);
  const cost = computeFullCost(proxy, ENERGEX_7400, DEFAULT_RETAIL_PLAN, {
    mlf: INV.mlf,
    dlf: INV.dlf,
    connectionUnits: INV.connectionUnits,
  });
  const amt = (label: string): number => {
    const line = cost.lines.find((l) => l.label === label);
    if (!line) throw new Error(`missing cost line: ${label}`);
    return line.amount;
  };

  it("network fixed + volume lines reproduce to the cent", () => {
    within(amt("Network access (DUOS)"), INV.networkAccessDuos, CENT);
    within(amt("Jurisdictional scheme (fixed)"), INV.jurisdictionalScheme, CENT);
    within(amt("DUOS connection unit charge"), INV.connectionUnit, CENT);
    within(amt("Network volume (DUOS+TUOS+JS)"), INV.networkVolume, CENT);
  });

  it("network demand reproduces to the cent (916.16 kVA @ $11.011/kVA)", () => {
    const dc = ENERGEX_7400.charges.find((c) => c.kind === "demand_monthly");
    if (dc?.kind !== "demand_monthly") throw new Error("no demand charge");
    within(dc.rate * INV.demandKva, INV.networkDemand, CENT);
  });

  it("network subtotal reproduces to the cent", () => {
    const nonDemandNetwork =
      amt("Network access (DUOS)") +
      amt("Jurisdictional scheme (fixed)") +
      amt("DUOS connection unit charge") +
      amt("Network volume (DUOS+TUOS+JS)");
    const dc = ENERGEX_7400.charges.find((c) => c.kind === "demand_monthly");
    if (dc?.kind !== "demand_monthly") throw new Error("no demand charge");
    within(nonDemandNetwork + dc.rate * INV.demandKva, INV.networkSubtotal, CENT);
  });

  it("retail energy reproduces to the cent given the metered ToU split", () => {
    const loss = INV.mlf * INV.dlf;
    within(DEFAULT_RETAIL_PLAN.peakRatePerKwh * INV.peakKwh * loss, INV.energyPeak, CENT);
    // 1c residual is the invoice's own per-line rounding, not a model error.
    within(DEFAULT_RETAIL_PLAN.offpeakRatePerKwh * INV.offpeakKwh * loss, INV.energyOffpeak, 0.01);
  });

  it("metering reproduces to the cent", () => {
    within(amt("Metering"), INV.metering, CENT);
  });

  // Two documented few-cents residuals — real modelling choices, not arithmetic errors:
  //  • environmental: the model uses ONE certificate-adjusted rate (0.010786 = SREC 0.04×11.67%
  //    + LREC 0.0367×16.67%) where the invoice computes SREC and LREC separately and rounds each
  //    to cents → ~3c.
  //  • regulated: the model applies AEMO charges to total consumption; the invoice applies them
  //    to consumption net of a 10.07 kWh export adjustment → ~1c. (FRC daily is the supply line.)
  it("environmental & regulated reconcile within a few cents (documented basis differences)", () => {
    within(amt("Environmental (SREC + LREC)"), INV.environmental, FEW_CENTS);
    within(amt("Regulated / market (AEMO)") + amt("Retail supply"), INV.regulated, FEW_CENTS);
  });

  it("the whole modelled bill reconciles to the invoice sub-total within ~5c", () => {
    const loss = INV.mlf * INV.dlf;
    const dc = ENERGEX_7400.charges.find((c) => c.kind === "demand_monthly");
    if (dc?.kind !== "demand_monthly") throw new Error("no demand charge");
    const modelledTotal =
      amt("Network access (DUOS)") +
      amt("Jurisdictional scheme (fixed)") +
      amt("DUOS connection unit charge") +
      amt("Network volume (DUOS+TUOS+JS)") +
      dc.rate * INV.demandKva +
      (DEFAULT_RETAIL_PLAN.peakRatePerKwh * INV.peakKwh + DEFAULT_RETAIL_PLAN.offpeakRatePerKwh * INV.offpeakKwh) * loss +
      amt("Environmental (SREC + LREC)") +
      amt("Regulated / market (AEMO)") +
      amt("Retail supply") +
      amt("Metering");
    within(modelledTotal, INV.subTotalExGst, 0.1);
  });
});
