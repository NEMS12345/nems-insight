import { describe, it, expect } from "vitest";
import { parseNem12 } from "@/ingestion/parsers/nem12";
import {
  peakDemand,
  loadProfileByTimeOfDay,
  aestMinuteOfDay,
  type AnalyticsReading,
} from "@/core/analytics";

// NEM12 convention: 48 interval-ENDING values per day in NEM time (AEST, no DST). value[1]
// covers 00:00–00:30 (ending 00:30); value[48] covers 23:30–24:00. We store interval-START
// (00:00, 00:30, …, 23:30), so a midday-peaking site must surface as a midday peak — never
// shifted to the small hours (which would indicate a UTC/local or off-by-one bug).

/** A 30-minute day whose load clearly peaks at midday (interval 24 ⇒ 12:00). */
function middayPeakingFile(date = "20240701"): string {
  const values = Array.from({ length: 48 }, (_, i) => {
    const hour = i / 2;
    // bell curve centred on 13:00; low overnight
    return (10 + 90 * Math.exp(-((hour - 13) ** 2) / 8)).toFixed(3);
  });
  return [
    "100,NEM12,200401021200,MDP,RET",
    "200,6100000000,E1,E1,E1,N1,M1,KWH,30,20240102",
    `300,${date},${values.join(",")},A,,,20240102000000,20240102000000`,
    "900",
  ].join("\n");
}

describe("NEM12 timestamp convention (AEST, interval-start)", () => {
  const parsed = parseNem12(middayPeakingFile());
  const errors = parsed.errors;
  const readings = parsed.readings as unknown as AnalyticsReading[];

  it("maps the first value to 00:00 and the last to 23:30 (interval-start)", () => {
    expect(errors).toEqual([]);
    expect(readings[0].intervalStart).toBe("2024-07-01T00:00:00+10:00");
    expect(readings[47].intervalStart).toBe("2024-07-01T23:30:00+10:00");
  });

  it("a midday-peaking profile peaks at midday — NOT the small hours", () => {
    const peak = peakDemand(readings);
    // demand peak should land around 12:30–13:30, i.e. minute-of-day ~750–810
    const min = aestMinuteOfDay(peak.at!);
    expect(min).toBeGreaterThanOrEqual(12 * 60);
    expect(min).toBeLessThanOrEqual(14 * 60);
  });

  it("the load profile's busiest slot is in daytime, not overnight", () => {
    const profile = loadProfileByTimeOfDay(readings);
    const busiest = profile.reduce((a, b) => (b.avgKw > a.avgKw ? b : a));
    expect(busiest.minuteOfDay).toBeGreaterThanOrEqual(11 * 60);
    expect(busiest.minuteOfDay).toBeLessThanOrEqual(15 * 60);
  });
});
