import { describe, it, expect } from "vitest";
import {
  getTariff,
  TARIFF_VERSIONS,
  ENERGEX_7200,
  ENERGEX_7400,
  effectiveBoundariesWithin,
  pickEffectiveStrict,
  type Tariff,
} from "@/core/tariff";

describe("getTariff — current behaviour (no asOf)", () => {
  it("returns the latest version of a known code", () => {
    expect(getTariff("7200")).toBe(ENERGEX_7200);
    expect(getTariff("7400")).toBe(ENERGEX_7400);
  });
  it("returns undefined for an unknown code", () => {
    expect(getTariff("9999")).toBeUndefined();
    expect(getTariff("")).toBeUndefined();
  });
});

describe("getTariff — effective-dated selection", () => {
  // A synthetic two-version code so the test pins selection logic without fabricating Energex
  // rates. Mirrors the shape the registry takes once a 1-July rate update is added.
  const v2025: Tariff = { ...ENERGEX_7400, effectiveFrom: "2025-07-01" };
  const v2026: Tariff = {
    ...ENERGEX_7400,
    effectiveFrom: "2026-07-01",
    charges: ENERGEX_7400.charges.map((c) =>
      c.kind === "energy" ? { ...c, rate: 0.025 } : c,
    ),
  };

  // Register a temporary code for the duration of the suite.
  TARIFF_VERSIONS["TEST"] = [v2026, v2025];

  it("picks the version effective on the bill date", () => {
    expect(getTariff("TEST", "2025-12-01")).toBe(v2025);
    expect(getTariff("TEST", "2026-07-01")).toBe(v2026); // boundary is inclusive
    expect(getTariff("TEST", "2027-03-01")).toBe(v2026);
  });

  it("falls back to the oldest version for a date before any version", () => {
    expect(getTariff("TEST", "2024-01-01")).toBe(v2025);
  });

  it("without asOf returns the newest version regardless of array order", () => {
    expect(getTariff("TEST")).toBe(v2026);
  });
});

describe("getTariff — single undated version", () => {
  it("returns the only version for any date", () => {
    // The real Energex codes each have one version today.
    expect(getTariff("7200", "2020-01-01")).toBe(ENERGEX_7200);
    expect(getTariff("7400", "2030-01-01")).toBe(ENERGEX_7400);
  });
});

describe("billing-safe effective dating", () => {
  const versions = [
    { effectiveFrom: "2025-07-01", value: 1 },
    { effectiveFrom: "2026-07-01", value: 2 },
  ];

  it("does not apply the oldest held version before it became effective", () => {
    expect(pickEffectiveStrict(versions, "2025-06-30")).toBeUndefined();
  });

  it("finds changes occurring inside a billing period", () => {
    expect(effectiveBoundariesWithin(versions, "2026-06-15", "2026-07-14"))
      .toEqual(["2026-07-01"]);
  });
});
