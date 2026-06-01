import { describe, it, expect } from "vitest";
import type { AnalyticsReading } from "@/core/analytics";
import {
  consumptionSummary,
  dailyConsumption,
  peakDemand,
  averageDemandKw,
  periodPowerFactor,
  powerFactorByInterval,
  loadProfileByTimeOfDay,
  aestDate,
  aestMinuteOfDay,
  channelKind,
} from "@/core/analytics";

function r(
  channel: string,
  intervalStart: string,
  value: number,
  opts: Partial<AnalyticsReading> = {},
): AnalyticsReading {
  return {
    channel,
    intervalStart,
    value,
    intervalLength: opts.intervalLength ?? 30,
    unit: opts.unit ?? (channelKind(channel) === "reactive" ? "kVArh" : "kWh"),
    quality: opts.quality ?? "actual",
  };
}

describe("channelKind", () => {
  it("classifies by NMI suffix first letter", () => {
    expect(channelKind("E1")).toBe("consumption");
    expect(channelKind("B1")).toBe("export");
    expect(channelKind("Q1")).toBe("reactive");
    expect(channelKind("K1")).toBe("reactive");
    expect(channelKind("X9")).toBe("other");
  });
});

describe("time helpers (AEST)", () => {
  it("maps a UTC timestamp to the correct AEST date and minute-of-day", () => {
    // 14:30Z on 31 Dec == 00:30 on 1 Jan AEST (+10).
    expect(aestDate("2023-12-31T14:30:00Z")).toBe("2024-01-01");
    expect(aestMinuteOfDay("2023-12-31T14:30:00Z")).toBe(30);
  });
  it("reads the wall time straight from a +10:00 timestamp", () => {
    expect(aestMinuteOfDay("2024-01-01T06:00:00+10:00")).toBe(360);
  });
});

describe("consumptionSummary", () => {
  it("separates import/export and reports estimated fraction", () => {
    const s = consumptionSummary([
      r("E1", "2024-01-01T00:00:00+10:00", 2),
      r("E1", "2024-01-01T00:30:00+10:00", 4, { quality: "estimated" }),
      r("B1", "2024-01-01T00:00:00+10:00", 1), // export
    ]);
    expect(s.importKwh).toBe(6);
    expect(s.exportKwh).toBe(1);
    expect(s.netKwh).toBe(5);
    expect(s.intervalCount).toBe(2);
    expect(s.estimatedFraction).toBeCloseTo(0.5);
  });
});

describe("dailyConsumption", () => {
  it("totals import per AEST day, sorted", () => {
    const days = dailyConsumption([
      r("E1", "2024-01-01T23:30:00+10:00", 3),
      r("E1", "2024-01-02T00:00:00+10:00", 5),
      r("E1", "2024-01-02T00:30:00+10:00", 1),
      r("B1", "2024-01-02T00:00:00+10:00", 9), // export ignored
    ]);
    expect(days).toEqual([
      { date: "2024-01-01", importKwh: 3 },
      { date: "2024-01-02", importKwh: 6 },
    ]);
  });
});

describe("demand", () => {
  const readings = [
    r("E1", "2024-01-01T00:00:00+10:00", 5), // 5kWh/0.5h = 10kW
    r("E1", "2024-01-01T00:30:00+10:00", 3), // E1+E2 = 7kWh/0.5h = 14kW
    r("E2", "2024-01-01T00:30:00+10:00", 4),
  ];
  it("finds peak demand summing channels within an interval", () => {
    const p = peakDemand(readings);
    expect(p.kw).toBe(14);
    expect(p.at).toBe("2024-01-01T00:30:00+10:00");
  });
  it("averages interval demand", () => {
    expect(averageDemandKw(readings)).toBe(12); // (10 + 14) / 2
  });
});

describe("powerFactor", () => {
  it("computes period power factor from real and reactive energy", () => {
    const res = periodPowerFactor([
      r("E1", "2024-01-01T00:00:00+10:00", 3),
      r("Q1", "2024-01-01T00:00:00+10:00", 4),
    ]);
    expect(res.realKwh).toBe(3);
    expect(res.reactiveKvarh).toBe(4);
    expect(res.powerFactor).toBeCloseTo(0.6); // 3 / sqrt(3^2+4^2) = 3/5
  });
  it("returns power factor 1 when there is no reactive data", () => {
    const res = periodPowerFactor([r("E1", "2024-01-01T00:00:00+10:00", 5)]);
    expect(res.powerFactor).toBe(1);
  });
  it("returns null when there is no energy at all", () => {
    expect(periodPowerFactor([]).powerFactor).toBeNull();
  });
  it("aligns real and reactive by interval", () => {
    const series = powerFactorByInterval([
      r("E1", "2024-01-01T00:00:00+10:00", 3),
      r("Q1", "2024-01-01T00:00:00+10:00", 4),
      r("E1", "2024-01-01T00:30:00+10:00", 6),
      r("Q1", "2024-01-01T00:30:00+10:00", 8),
    ]);
    expect(series).toHaveLength(2);
    expect(series[0].powerFactor).toBeCloseTo(0.6);
    expect(series[1].powerFactor).toBeCloseTo(0.6);
  });
});

describe("loadProfileByTimeOfDay", () => {
  it("averages consumption power per time-of-day slot across days", () => {
    const profile = loadProfileByTimeOfDay([
      r("E1", "2024-01-01T06:00:00+10:00", 1), // 2 kW
      r("E1", "2024-01-02T06:00:00+10:00", 2), // 4 kW
      r("E1", "2024-01-01T06:30:00+10:00", 3), // 6 kW
    ]);
    const slot0600 = profile.find((p) => p.minuteOfDay === 360)!;
    expect(slot0600.avgKw).toBe(3); // (2 + 4) / 2
    expect(slot0600.samples).toBe(2);
    const slot0630 = profile.find((p) => p.minuteOfDay === 390)!;
    expect(slot0630.avgKw).toBe(6);
    expect(profile[0].minuteOfDay).toBeLessThan(profile[1].minuteOfDay);
  });
});
