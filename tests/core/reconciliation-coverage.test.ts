import { describe, it, expect } from "vitest";
import {
  reconcile,
  periodCoverage,
  daysInPeriodInclusive,
  type BillComponent,
} from "@/core/reconciliation";

describe("daysInPeriodInclusive", () => {
  it("counts both endpoints", () => {
    expect(daysInPeriodInclusive("2026-03-01", "2026-03-31")).toBe(31);
    expect(daysInPeriodInclusive("2026-03-01", "2026-03-01")).toBe(1);
  });
  it("spans a month boundary", () => {
    expect(daysInPeriodInclusive("2026-02-15", "2026-03-15")).toBe(29); // 2026 is not a leap year
  });
  it("is 0 for a reversed range", () => {
    expect(daysInPeriodInclusive("2026-03-31", "2026-03-01")).toBe(0);
  });
});

describe("periodCoverage", () => {
  const start = "2026-03-01";
  const end = "2026-03-31"; // 31 days

  it("is 1 when every day has data", () => {
    const dates = Array.from({ length: 31 }, (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`);
    expect(periodCoverage(dates, start, end)).toBe(1);
  });

  it("counts distinct days only (duplicates from many intervals per day don't inflate)", () => {
    const dates = ["2026-03-01", "2026-03-01", "2026-03-02"]; // 2 distinct of 31
    expect(periodCoverage(dates, start, end)).toBeCloseTo(2 / 31, 6);
  });

  it("ignores readings outside the period", () => {
    const dates = ["2026-02-28", "2026-03-01", "2026-04-01"]; // only 1 in-period
    expect(periodCoverage(dates, start, end)).toBeCloseTo(1 / 31, 6);
  });

  it("is capped at 1 and 0 for an empty period", () => {
    expect(periodCoverage(["2026-03-01"], "2026-03-31", "2026-03-01")).toBe(0);
  });
});

// A small modelled/billed pair that matches cleanly, so the ONLY thing that can move the
// judgement is the coverage gate.
const modelled: BillComponent[] = [
  { kind: "energy", subKey: "peak", label: "Energy peak", amount: 1000, nature: "modelled" },
  { kind: "demand", label: "Demand", amount: 500, nature: "modelled" },
];
const billed: BillComponent[] = [
  { kind: "energy", subKey: "peak", label: "Energy peak", amount: 1000, nature: "modelled" },
  { kind: "demand", label: "Demand", amount: 500, nature: "modelled" },
];

describe("reconcile — coverage gate", () => {
  it("defaults to full coverage and a normal verdict", () => {
    const res = reconcile(modelled, billed);
    expect(res.coverageFraction).toBe(1);
    expect(res.judgement).toBe("match");
  });

  it("withholds the verdict as 'insufficient-data' below the coverage floor", () => {
    const res = reconcile(modelled, billed, { coverageFraction: 20 / 31 }); // ~65%
    expect(res.judgement).toBe("insufficient-data");
    expect(res.confidence).toBe("low");
  });

  it("insufficient-data overrides what would otherwise be an 'investigate'", () => {
    const overBilled: BillComponent[] = [
      { kind: "energy", subKey: "peak", label: "Energy peak", amount: 5000, nature: "modelled" },
      { kind: "demand", label: "Demand", amount: 500, nature: "modelled" },
    ];
    // Full coverage → this is a clear billing error.
    expect(reconcile(modelled, overBilled).judgement).toBe("investigate");
    // Partial coverage → we can't trust it; withhold instead of accuse.
    expect(reconcile(modelled, overBilled, { coverageFraction: 0.5 }).judgement).toBe(
      "insufficient-data",
    );
  });

  it("passes a verdict at or above the coverage floor", () => {
    const res = reconcile(modelled, billed, { coverageFraction: 0.95 });
    expect(res.judgement).toBe("match");
  });

  it("honours a custom minimum coverage", () => {
    const res = reconcile(modelled, billed, {
      coverageFraction: 0.8,
      minCoverageFraction: 0.75,
    });
    expect(res.judgement).toBe("match");
  });
});
