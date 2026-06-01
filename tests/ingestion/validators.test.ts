import { describe, it, expect } from "vitest";
import { summariseQuality } from "@/ingestion/validators/quality";
import { detectGaps } from "@/ingestion/validators/gaps";
import type { Nem12Reading } from "@/ingestion/parsers/nem12";

describe("summariseQuality", () => {
  it("counts flags and computes the non-actual fraction", () => {
    const s = summariseQuality([
      { quality: "actual" },
      { quality: "actual" },
      { quality: "estimated" },
      { quality: "substituted" },
    ]);
    expect(s.total).toBe(4);
    expect(s.byFlag.actual).toBe(2);
    expect(s.byFlag.estimated).toBe(1);
    expect(s.nonActualFraction).toBeCloseTo(0.5);
  });

  it("handles an empty set without dividing by zero", () => {
    const s = summariseQuality([]);
    expect(s.total).toBe(0);
    expect(s.nonActualFraction).toBe(0);
  });
});

function reading(intervalStart: string): Nem12Reading {
  return {
    nmi: "31000000000",
    channel: "E1",
    intervalStart,
    intervalLength: 30,
    value: 1,
    unit: "kWh",
    quality: "actual",
  };
}

describe("detectGaps", () => {
  it("finds an internal missing interval", () => {
    const gaps = detectGaps([
      reading("2024-01-01T00:00:00+10:00"),
      // 00:30 is missing
      reading("2024-01-01T01:00:00+10:00"),
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missingIntervals).toBe(1);
    expect(gaps[0].to).toBe("2024-01-01T01:00:00+10:00");
  });

  it("counts multiple consecutive missing intervals", () => {
    const gaps = detectGaps([
      reading("2024-01-01T00:00:00+10:00"),
      // 00:30, 01:00, 01:30 missing
      reading("2024-01-01T02:00:00+10:00"),
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missingIntervals).toBe(3);
  });

  it("reports no gaps for a contiguous series", () => {
    const gaps = detectGaps([
      reading("2024-01-01T00:00:00+10:00"),
      reading("2024-01-01T00:30:00+10:00"),
      reading("2024-01-01T01:00:00+10:00"),
    ]);
    expect(gaps).toEqual([]);
  });
});
