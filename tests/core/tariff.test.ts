import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import type { Tariff } from "@/core/tariff";
import {
  classifyPeriod,
  computeCost,
  reconcile,
  ENERGEX_7200,
} from "@/core/tariff";

// 2024-07-01 is a Monday (weekday); 2024-07-06 is a Saturday (weekend).
const MON = "2024-07-01";
const SAT = "2024-07-06";

function at(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00+10:00`;
}

function e1(date: string, hhmm: string, kwh: number): AnalyticsReading {
  return {
    channel: "E1",
    intervalStart: at(date, hhmm),
    intervalLength: 30,
    value: kwh,
    unit: "kWh",
    quality: "actual",
  };
}

describe("classifyPeriod (Energex 7200 windows)", () => {
  const p = ENERGEX_7200.periods;
  it("peak is 5–8pm weekdays only", () => {
    expect(classifyPeriod(at(MON, "17:30"), p)).toBe("peak");
    expect(classifyPeriod(at(MON, "19:30"), p)).toBe("peak");
    expect(classifyPeriod(at(MON, "20:00"), p)).toBe("shoulder"); // 8pm boundary exclusive
    expect(classifyPeriod(at(SAT, "18:00"), p)).toBe("shoulder"); // no weekend peak
  });
  it("off-peak is 11am–1pm every day", () => {
    expect(classifyPeriod(at(MON, "12:00"), p)).toBe("offpeak");
    expect(classifyPeriod(at(SAT, "11:30"), p)).toBe("offpeak");
    expect(classifyPeriod(at(MON, "13:00"), p)).toBe("shoulder"); // 1pm boundary exclusive
  });
  it("everything else is shoulder", () => {
    expect(classifyPeriod(at(MON, "09:30"), p)).toBe("shoulder");
    expect(classifyPeriod(at(MON, "02:00"), p)).toBe("shoulder");
  });
});

describe("computeCost", () => {
  const tariff: Tariff = {
    code: "TEST",
    name: "Test",
    network: "Energex",
    currency: "AUD",
    voltageClass: "LV", hasEstimatedCharges: false,
    periods: {
      peak: { dayTypes: ["weekday"], ranges: [{ startMin: 1020, endMin: 1200 }] },
      offpeak: {
        dayTypes: ["weekday", "weekend"],
        ranges: [{ startMin: 660, endMin: 780 }],
      },
    },
    charges: [
      { kind: "fixed_daily", category: "network", label: "Fixed", ratePerDay: 10 },
      { kind: "energy", category: "network", label: "Peak", period: "peak", rate: 0.1 },
      { kind: "energy", category: "network", label: "Shoulder", period: "shoulder", rate: 0.05 },
      { kind: "energy", category: "network", label: "Off-peak", period: "offpeak", rate: 0.02 },
      {
        kind: "demand_monthly",
        category: "network",
        label: "Peak demand",
        period: "peak",
        unit: "kW",
        rate: 20,
      },
    ],
  };

  const readings = [
    e1(MON, "17:00", 5), // peak, 10 kW
    e1(MON, "17:30", 7), // peak, 14 kW  <- monthly peak max
    e1(MON, "12:00", 2), // off-peak
    e1(MON, "09:30", 3), // shoulder
  ];

  it("costs energy by period, demand by monthly max, and fixed by day", () => {
    const c = computeCost(readings, tariff);
    expect(c.energyByPeriod).toEqual({ peak: 12, shoulder: 3, offpeak: 2 });
    expect(c.days).toBe(1);

    const amount = (label: string) =>
      c.lines.find((l) => l.label === label)!.amount;
    expect(amount("Fixed")).toBeCloseTo(10);
    expect(amount("Peak")).toBeCloseTo(1.2); // 0.10 * 12
    expect(amount("Shoulder")).toBeCloseTo(0.15); // 0.05 * 3
    expect(amount("Off-peak")).toBeCloseTo(0.04); // 0.02 * 2
    expect(amount("Peak demand")).toBeCloseTo(280); // 14 kW * 20
    expect(c.total).toBeCloseTo(291.39);
  });

  it("sums demand across calendar months (not one global peak)", () => {
    const c = computeCost(
      [
        e1("2024-07-01", "17:30", 10), // July peak 20 kW
        e1("2024-08-05", "17:30", 6), // August peak 12 kW (Aug 5 is a Monday)
      ],
      tariff,
    );
    // 20 + 12 = 32 kW summed across two months * $20
    expect(c.lines.find((l) => l.label === "Peak demand")!.amount).toBeCloseTo(640);
  });

  it("ENERGEX tariffs are network-only (retail is per-NMI)", () => {
    const c = computeCost([e1(MON, "17:30", 100)], ENERGEX_7200);
    expect(c.networkTotal).toBeGreaterThan(0);
    expect(c.retailTotal).toBe(0);
  });

  it("aggregates 5-minute readings into the tariff's 30-minute demand interval", () => {
    const fiveMinuteRows: AnalyticsReading[] = Array.from({ length: 6 }, (_, index) => ({
      channel: "E1",
      intervalStart: at(MON, `17:${String(index * 5).padStart(2, "0")}`),
      intervalLength: 5,
      value: index === 0 ? 10 : 0,
      unit: "kWh",
      quality: "actual",
    }));
    const c = computeCost(fiveMinuteRows, tariff);
    expect(c.lines.find((l) => l.label === "Peak demand")!.amount).toBeCloseTo(400);
    // 10 kWh across the 30-minute demand interval = 20 kW × $20, not a 120 kW spike.
  });
});

describe("kVA demand and monthly fixed charges", () => {
  const tariff: Tariff = {
    code: "KVA",
    name: "kVA test",
    network: "Energex",
    currency: "AUD",
    voltageClass: "LV", hasEstimatedCharges: false,
    periods: {
      peak: { dayTypes: ["weekday"], ranges: [{ startMin: 1020, endMin: 1200 }] },
      offpeak: { dayTypes: [], ranges: [] },
    },
    charges: [
      { kind: "fixed_monthly", category: "network", label: "Connection", ratePerMonth: 100 },
      {
        kind: "demand_monthly",
        category: "network",
        label: "kVA demand",
        period: "peak",
        unit: "kVA",
        rate: 10,
      },
    ],
  };

  it("computes apparent power (kVA) from real + reactive and charges monthly fixed", () => {
    const c = computeCost(
      [
        // peak interval: 6 kWh -> 12 kW, 8 kVArh -> 16 kVAr => kVA = sqrt(12^2+16^2)=20
        e1(MON, "17:00", 6),
        { channel: "Q1", intervalStart: at(MON, "17:00"), intervalLength: 30, value: 8, unit: "kVArh", quality: "actual" },
      ],
      tariff,
    );
    expect(c.lines.find((l) => l.label === "kVA demand")!.amount).toBeCloseTo(200); // 20 kVA * 10
    expect(c.lines.find((l) => l.label === "Connection")!.amount).toBeCloseTo(100); // 1 month
  });
});

describe("loss factors", () => {
  const tariff: Tariff = {
    code: "LF",
    name: "loss test",
    network: "Energex",
    currency: "AUD",
    voltageClass: "LV", hasEstimatedCharges: false,
    periods: {
      peak: { dayTypes: ["weekday"], ranges: [{ startMin: 1020, endMin: 1200 }] },
      offpeak: { dayTypes: [], ranges: [] },
    },
    charges: [
      { kind: "energy", category: "retail", label: "MLF×DLF", period: "all", rate: 0.1, losses: ["MLF", "DLF"] },
      { kind: "energy", category: "network", label: "no loss", period: "all", rate: 0.1 },
    ],
  };

  it("applies only the listed loss factors to each charge", () => {
    const c = computeCost([e1(MON, "17:00", 10)], tariff, { mlf: 1.01, dlf: 1.04 });
    expect(c.lines.find((l) => l.label === "MLF×DLF")!.amount).toBeCloseTo(
      0.1 * 10 * 1.01 * 1.04,
    );
    expect(c.lines.find((l) => l.label === "no loss")!.amount).toBeCloseTo(1.0);
  });
});

describe("connection_unit charge", () => {
  const tariff: Tariff = {
    code: "CU",
    name: "connection unit test",
    network: "Energex",
    currency: "AUD",
    voltageClass: "HV",
    hasEstimatedCharges: false,
    periods: { peak: { dayTypes: [], ranges: [] }, offpeak: { dayTypes: [], ranges: [] } },
    charges: [{ kind: "connection_unit", category: "network", label: "Connection unit", ratePerUnit: 245.582 }],
  };

  it("charges rate × the supplied connection-unit count", () => {
    const c = computeCost([e1(MON, "10:00", 5)], tariff, { connectionUnits: 7 });
    expect(c.lines.find((l) => l.label === "Connection unit")!.amount).toBeCloseTo(245.582 * 7, 2);
  });

  it("models $0 (and says so) when no count is set, rather than guessing", () => {
    const c = computeCost([e1(MON, "10:00", 5)], tariff);
    const line = c.lines.find((l) => l.label === "Connection unit")!;
    expect(line.amount).toBe(0);
    expect(line.detail).toMatch(/not set/i);
  });
});

describe("reconcile", () => {
  it("flags match / review / investigate by variance band", () => {
    expect(reconcile(100, 101).status).toBe("match"); // 1%
    expect(reconcile(100, 108).status).toBe("review"); // 8%
    expect(reconcile(100, 130).status).toBe("investigate"); // 30%
    const r = reconcile(100, 130);
    expect(r.variance).toBe(30);
    expect(r.variancePct).toBeCloseTo(0.3);
  });
});
