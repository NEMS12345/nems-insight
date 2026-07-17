import { describe, it, expect } from "vitest";
import { parseNem12 } from "@/ingestion/parsers/nem12";

/** Build a 300 row with `n` identical values. */
function row300(date: string, n: number, value: number, quality = "A"): string {
  return `300,${date},${Array(n).fill(value).join(",")},${quality},,,20240102000000,20240102000000`;
}

const NMI = "31000000000";

describe("parseNem12", () => {
  it("parses a single-day, single-channel 30-minute file", () => {
    const file = [
      "100,NEM12,200401021200,MDP,RETAILER",
      `200,${NMI},E1E2,E1,E1,N1,METER001,KWH,30,20240102`,
      row300("20240101", 48, 1.5, "A"),
      "900",
    ].join("\n");

    const res = parseNem12(file);

    expect(res.errors).toEqual([]);
    expect(res.nmis).toEqual([NMI]);
    expect(res.readings).toHaveLength(48);

    const first = res.readings[0];
    expect(first.channel).toBe("E1");
    expect(first.unit).toBe("kWh");
    expect(first.value).toBe(1.5);
    expect(first.quality).toBe("actual");
    expect(first.intervalLength).toBe(30);
    expect(first.intervalStart).toBe("2024-01-01T00:00:00+10:00");
    expect(res.readings[47].intervalStart).toBe("2024-01-01T23:30:00+10:00");
  });

  it("handles multiple channels (consumption + reactive) under one NMI", () => {
    const file = [
      "100,NEM12,200401021200,MDP,RETAILER",
      `200,${NMI},E1,E1,E1,N1,METER001,KWH,30,20240102`,
      row300("20240101", 48, 2),
      `200,${NMI},Q1,Q1,Q1,N1,METER001,KVARH,30,20240102`,
      row300("20240101", 48, 0.4),
      "900",
    ].join("\n");

    const res = parseNem12(file);
    expect(res.errors).toEqual([]);
    expect(res.nmis).toEqual([NMI]);
    expect(res.readings).toHaveLength(96);

    const q = res.readings.filter((r) => r.channel === "Q1");
    expect(q).toHaveLength(48);
    expect(q[0].unit).toBe("kVArh");
  });

  it("applies per-interval quality from 400 records when the day is variable", () => {
    const file = [
      `200,${NMI},E1,E1,E1,N1,METER001,KWH,30,20240102`,
      `300,20240101,${Array(48).fill(1).join(",")},V,,,20240102000000,20240102000000`,
      "400,1,10,E62,,",
      "400,11,48,A,,",
      "900",
    ].join("\n");

    const res = parseNem12(file);
    expect(res.errors).toEqual([]);
    expect(res.readings).toHaveLength(48);
    expect(res.readings.slice(0, 10).every((r) => r.quality === "estimated")).toBe(true);
    expect(res.readings.slice(10).every((r) => r.quality === "actual")).toBe(true);
  });

  it("parses 5-minute interval data (288 intervals/day)", () => {
    const file = [
      `200,${NMI},E1,E1,E1,N1,METER001,KWH,5,20240102`,
      row300("20240101", 288, 0.1),
      "900",
    ].join("\n");

    const res = parseNem12(file);
    expect(res.errors).toEqual([]);
    expect(res.readings).toHaveLength(288);
    expect(res.readings[1].intervalStart).toBe("2024-01-01T00:05:00+10:00");
  });

  it("records an error for an invalid interval length and emits no readings", () => {
    const file = [
      `200,${NMI},E1,E1,E1,N1,METER001,KWH,7,20240102`,
      row300("20240101", 48, 1),
      "900",
    ].join("\n");

    const res = parseNem12(file);
    expect(res.readings).toHaveLength(0);
    expect(res.errors.some((e) => e.includes("invalid interval length"))).toBe(true);
  });

  it("skips a single bad value but keeps the rest of the row", () => {
    const values = Array(48).fill(1);
    values[5] = "oops";
    const file = [
      `200,${NMI},E1,E1,E1,N1,METER001,KWH,30,20240102`,
      `300,20240101,${values.join(",")},A,,,20240102000000,20240102000000`,
      "900",
    ].join("\n");

    const res = parseNem12(file);
    expect(res.readings).toHaveLength(47);
    expect(res.errors.some((e) => e.includes("non-numeric value"))).toBe(true);
  });

  it("warns but parses when there is no 100 header", () => {
    const file = [
      `200,${NMI},E1,E1,E1,N1,METER001,KWH,30,20240102`,
      row300("20240101", 48, 1),
    ].join("\n");

    const res = parseNem12(file);
    expect(res.readings).toHaveLength(48);
    expect(res.warnings.some((w) => w.includes("100 header"))).toBe(true);
  });
});

describe("parseNem12 — DST transition days", () => {
  // 30-min 300 record with `n` values for a given date.
  const row = (date: string, n: number) =>
    [
      "100,NEM12,200401021200,MDP,RET",
      `200,${NMI},E1,E1,E1,N1,M1,KWH,30,20240102`,
      `300,${date},${Array(n).fill(1).join(",")},A,,,20240102000000,20240102000000`,
      "900",
    ].join("\n");

  // NSW/VIC: DST ends first Sunday of April (fall back, 25h) and starts first Sunday of
  // October (spring forward, 23h). 2025: 6 Apr and 5 Oct.
  const FALL_BACK = "20250406";
  const SPRING_FWD = "20251005";

  it("parses a fall-back day as 50 intervals (not 48) and flags it", () => {
    const res = parseNem12(row(FALL_BACK, 50), { timeBasis: "local", observesDst: true });
    expect(res.errors).toEqual([]);
    expect(res.readings).toHaveLength(50);
    expect(res.warnings.some((w) => /fall-back/i.test(w))).toBe(true);
    // The 02:00–03:00 hour repeats: once at +11:00 (AEDT) then again at +10:00 (AEST).
    const at0200 = res.readings.filter((r) => r.intervalStart.includes("T02:00:00"));
    expect(at0200.map((r) => r.intervalStart)).toEqual([
      "2025-04-06T02:00:00+11:00",
      "2025-04-06T02:00:00+10:00",
    ]);
    expect(res.readings[49].intervalStart).toBe("2025-04-06T23:30:00+10:00");
  });

  it("parses a spring-forward day as 46 intervals (not 48) and flags it", () => {
    const res = parseNem12(row(SPRING_FWD, 46), { timeBasis: "local", observesDst: true });
    expect(res.errors).toEqual([]);
    expect(res.readings).toHaveLength(46);
    expect(res.warnings.some((w) => /spring-forward/i.test(w))).toBe(true);
    // 02:00–03:00 is skipped: there is no 02:00, and the clock jumps to 03:00 at +11:00.
    expect(res.readings.some((r) => r.intervalStart.includes("T02:00:00"))).toBe(false);
    expect(res.readings[4].intervalStart).toBe("2025-10-05T03:00:00+11:00");
  });

  it("market basis (default) still parses an odd count but flags a possible local-time file", () => {
    const res = parseNem12(row(FALL_BACK, 50));
    expect(res.readings).toHaveLength(50); // not dropped
    expect(res.warnings.some((w) => /local time|timeBasis/i.test(w))).toBe(true);
  });

  it("a normal 48-interval day raises no anomaly warning", () => {
    const res = parseNem12(row("20240701", 48));
    expect(res.readings).toHaveLength(48);
    expect(res.warnings.some((w) => /anomaly|DST/i.test(w))).toBe(false);
  });
});
