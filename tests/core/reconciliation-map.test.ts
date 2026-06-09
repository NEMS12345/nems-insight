import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import {
  computeCost,
  computeFullCost,
  ENERGEX_7200,
  ENERGEX_7400,
  DEFAULT_RETAIL_PLAN,
} from "@/core/tariff";
import {
  modelledComponents,
  billedComponents,
  billedBucketsTotal,
  reconcile,
  componentKey,
} from "@/core/reconciliation";

const MON = "2024-07-01"; // Monday

function e1(date: string, hhmm: string, kwh: number): AnalyticsReading {
  return {
    channel: "E1",
    intervalStart: `${date}T${hhmm}:00+10:00`,
    intervalLength: 30,
    value: kwh,
    unit: "kWh",
    quality: "actual",
  };
}

// A spread of load across peak (5–8pm), off-peak (11am–1pm) and shoulder (everything else).
const READINGS: AnalyticsReading[] = [
  e1(MON, "18:00", 100), // peak
  e1(MON, "12:00", 60), // off-peak
  e1(MON, "09:00", 40), // shoulder
];

describe("modelledComponents", () => {
  it("buckets energy by ToU and surfaces demand + supply from a 7200 cost", () => {
    const cost = computeCost(READINGS, ENERGEX_7200);
    const comps = modelledComponents(cost);
    const byKey = new Map(comps.map((c) => [componentKey(c), c]));

    expect(byKey.get("energy:peak")!.amount).toBeCloseTo(100 * 0.01876, 2);
    expect(byKey.get("energy:offpeak")!.amount).toBeCloseTo(60 * 0.01627, 2);
    expect(byKey.get("energy:shoulder")!.amount).toBeCloseTo(40 * 0.02947, 2);
    // Supply = the fixed daily charge over the one day present.
    expect(byKey.get("supply:")!.amount).toBeCloseTo(9.257, 2);
    // 7200 has a peak + shoulder demand charge; both roll into the single demand component.
    expect(byKey.get("demand:")).toBeTruthy();
    expect(comps.every((c) => c.nature === "modelled")).toBe(true);
  });

  it("distributes a flat 'all' network-volume charge across ToU buckets by energy share", () => {
    // 7400 peak window is 9am–9pm weekday; 02:00 falls outside → shoulder.
    const readings = [e1(MON, "12:00", 150), e1(MON, "02:00", 50)];
    const cost = computeCost(readings, ENERGEX_7400); // network volume is period 'all'
    const comps = modelledComponents(cost);
    const energy = comps.filter((c) => c.kind === "energy");
    const totalEnergyAud = energy.reduce((s, c) => s + c.amount, 0);
    // The whole flat volume charge is preserved, just split across buckets.
    const volumeLine = cost.lines.find((l) => l.subKey === "all")!;
    expect(totalEnergyAud).toBeCloseTo(volumeLine.amount, 2);
    // Split is proportional to energy: peak (150 kWh) gets more than shoulder (50 kWh).
    const peak = energy.find((c) => c.subKey === "peak")!.amount;
    const shoulder = energy.find((c) => c.subKey === "shoulder")!.amount;
    expect(peak).toBeGreaterThan(shoulder);
  });

  it("tags retail environmental/market as pass-through", () => {
    const cost = computeFullCost(READINGS, ENERGEX_7200, DEFAULT_RETAIL_PLAN);
    const comps = modelledComponents(cost);
    expect(comps.find((c) => c.kind === "environmental")!.nature).toBe("pass-through");
    expect(comps.find((c) => c.kind === "market_fees")!.nature).toBe("pass-through");
    expect(comps.find((c) => c.kind === "demand")!.nature).toBe("modelled");
  });
});

describe("billedComponents", () => {
  it("omits blank buckets and tags nature", () => {
    const comps = billedComponents({
      energyPeak: 10,
      demand: 500,
      environmental: 80,
      // others blank
    });
    expect(comps.map((c) => componentKey(c)).sort()).toEqual(
      ["demand:", "energy:peak", "environmental:"].sort(),
    );
    expect(comps.find((c) => c.kind === "environmental")!.nature).toBe("pass-through");
    expect(billedBucketsTotal({ energyPeak: 10, demand: 500, environmental: 80 })).toBe(590);
  });
});

describe("modelled vs billed reconciliation (end to end)", () => {
  it("flags an over-billed demand component as investigate but ignores pass-through gaps", () => {
    const cost = computeCost(READINGS, ENERGEX_7200);
    const modelled = modelledComponents(cost);
    const modelledDemand = modelled.find((c) => c.kind === "demand")!.amount;

    // Bill matches energy/supply but overcharges demand heavily and adds an env pass-through.
    const billed = billedComponents({
      energyPeak: modelled.find((c) => c.subKey === "peak")!.amount,
      energyShoulder: modelled.find((c) => c.subKey === "shoulder")!.amount,
      energyOffpeak: modelled.find((c) => c.subKey === "offpeak")!.amount,
      supply: modelled.find((c) => c.kind === "supply")!.amount,
      demand: modelledDemand * 1.5, // 50% over
      environmental: 200, // pass-through, must not count as an error
    });

    const result = reconcile(modelled, billed);
    expect(result.judgement).toBe("investigate");
    const demand = result.components.find((c) => c.kind === "demand")!;
    expect(demand.status).toBe("investigate");
    // The env pass-through is reported but excluded from the modelled bottom line.
    expect(result.passThroughBilledAud).toBe(200);
    expect(result.components.find((c) => c.kind === "environmental")!.status).toBe("pass-through");
  });
});
