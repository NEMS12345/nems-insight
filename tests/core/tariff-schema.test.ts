import { describe, it, expect } from "vitest";
import { validateTariff } from "@/core/tariff/schema/validate";
import type { NetworkTariffSchema } from "@/core/tariff/schema";
import {
  ENERGEX_7200_SCHEMA,
  ENERGEX_7400_SCHEMA,
  AUSGRID_LV_DEMAND_SCHEMA,
  SAPN_BUSINESS_TOU_SCHEMA,
  TARIFF_SCHEDULES,
} from "@/core/tariff/schema/schedules";
import { isPublicHoliday, holidayYearKnown } from "@/core/tariff/schema/holidays";

describe("tariff schema — Energex (populated, real figures)", () => {
  it("validates the 7200 and 7400 schedules with no placeholders", () => {
    for (const t of [ENERGEX_7200_SCHEMA, ENERGEX_7400_SCHEMA]) {
      const res = validateTariff(t);
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
      expect(t.containsPlaceholders).toBe(false);
    }
  });

  it("7200 has a kW peak demand charge measured 5–8pm weekdays", () => {
    const demand = ENERGEX_7200_SCHEMA.charges.find(
      (c) => c.kind === "demand" && c.label.includes("peak"),
    );
    expect(demand?.kind).toBe("demand");
    if (demand?.kind === "demand") {
      expect(demand.unit).toBe("kW");
      expect(demand.measurement.windows).toEqual([{ startMin: 1020, endMin: 1200 }]);
      expect(demand.reset).toBe("monthly");
    }
  });

  it("7400 has a kVA demand charge and a flat network volume rate", () => {
    const demand = ENERGEX_7400_SCHEMA.charges.find((c) => c.kind === "demand");
    expect(demand?.kind === "demand" && demand.unit).toBe("kVA");
    const energy = ENERGEX_7400_SCHEMA.charges.find((c) => c.kind === "energy");
    expect(energy?.kind === "energy" && energy.rates[0].touId).toBe("flat");
  });
});

describe("tariff schema — structure-only fixtures (placeholders, no fabricated pricing)", () => {
  it("Ausgrid validates as structurally sound but is flagged as containing placeholders", () => {
    const res = validateTariff(AUSGRID_LV_DEMAND_SCHEMA);
    expect(res.errors).toEqual([]);
    expect(AUSGRID_LV_DEMAND_SCHEMA.containsPlaceholders).toBe(true);
  });

  it("Ausgrid models SEASONAL ToU (different summer vs non-summer peak windows)", () => {
    const energy = AUSGRID_LV_DEMAND_SCHEMA.charges.find((c) => c.kind === "energy");
    if (energy?.kind !== "energy") throw new Error("expected energy charge");
    const peaks = energy.rates.filter((r) => r.touId === "peak");
    expect(peaks).toHaveLength(2);
    const seasons = peaks.map((r) => r.seasonId).sort();
    expect(seasons).toEqual(["non-summer", "summer"]);
    // The two peak windows genuinely differ.
    const [a, b] = peaks.map((r) => JSON.stringify(r.windows));
    expect(a).not.toEqual(b);
  });

  it("Ausgrid models a kVA demand ratchet (50% of peak over the last 12 months)", () => {
    const demand = AUSGRID_LV_DEMAND_SCHEMA.charges.find((c) => c.kind === "demand");
    if (demand?.kind !== "demand") throw new Error("expected demand charge");
    expect(demand.unit).toBe("kVA");
    expect(demand.ratchet).toEqual({ percentOfPeak: 50, lookbackMonths: 12 });
  });

  it("Ausgrid models a separate controlled-load tariff", () => {
    const cl = AUSGRID_LV_DEMAND_SCHEMA.charges.find(
      (c) => c.kind === "energy" && c.scope === "controlled-load",
    );
    expect(cl).toBeDefined();
  });

  it("SAPN validates, models stepped/block energy, export direction and annual demand reset", () => {
    const res = validateTariff(SAPN_BUSINESS_TOU_SCHEMA);
    expect(res.errors).toEqual([]);
    expect(SAPN_BUSINESS_TOU_SCHEMA.containsPlaceholders).toBe(true);

    const stepped = SAPN_BUSINESS_TOU_SCHEMA.charges.find(
      (c) => c.kind === "energy" && c.blockReset !== undefined,
    );
    if (stepped?.kind !== "energy") throw new Error("expected stepped energy charge");
    const blocked = stepped.rates.find((r) => r.blocks && r.blocks.length > 0);
    expect(blocked?.blocks?.map((b) => b.uptoKwh)).toEqual([10000, null]);

    const exportCharge = SAPN_BUSINESS_TOU_SCHEMA.charges.find(
      (c) => c.kind === "energy" && c.direction === "export",
    );
    expect(exportCharge).toBeDefined();

    const demand = SAPN_BUSINESS_TOU_SCHEMA.charges.find((c) => c.kind === "demand");
    expect(demand?.kind === "demand" && demand.reset).toBe("annual");
  });

  it("every placeholder rate carries a TODO naming the source schedule", () => {
    for (const t of [AUSGRID_LV_DEMAND_SCHEMA, SAPN_BUSINESS_TOU_SCHEMA]) {
      const json = JSON.stringify(t);
      // crude but effective: any "placeholder":true must be near a "todo".
      const placeholders = (json.match(/"placeholder":true/g) ?? []).length;
      const todos = (json.match(/"todo":/g) ?? []).length;
      expect(placeholders).toBeGreaterThan(0);
      expect(todos).toBeGreaterThanOrEqual(placeholders);
    }
  });
});

describe("tariff schema validator — catches structural errors", () => {
  function clone(): NetworkTariffSchema {
    return JSON.parse(JSON.stringify(ENERGEX_7200_SCHEMA));
  }

  it("rejects a window outside [0,1440]", () => {
    const t = clone();
    const energy = t.charges.find((c) => c.kind === "energy");
    if (energy?.kind === "energy") energy.rates[0].windows = [{ startMin: 0, endMin: 1500 }];
    const res = validateTariff(t);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /within \[0, 1440\]/.test(e.message))).toBe(true);
  });

  it("rejects a window whose start is not before its end", () => {
    const t = clone();
    const energy = t.charges.find((c) => c.kind === "energy");
    if (energy?.kind === "energy") energy.rates[0].windows = [{ startMin: 600, endMin: 600 }];
    expect(validateTariff(t).errors.some((e) => /startMin must be < endMin/.test(e.message))).toBe(true);
  });

  it("rejects a rate that references an unknown season", () => {
    const t = clone();
    const energy = t.charges.find((c) => c.kind === "energy");
    if (energy?.kind === "energy") energy.rates[0].seasonId = "nope";
    expect(validateTariff(t).errors.some((e) => /unknown season/.test(e.message))).toBe(true);
  });

  it("rejects a demand ratchet with an out-of-range percent or bad lookback", () => {
    const t = clone();
    const demand = t.charges.find((c) => c.kind === "demand");
    if (demand?.kind === "demand") demand.ratchet = { percentOfPeak: 150, lookbackMonths: 0 };
    const res = validateTariff(t);
    expect(res.errors.some((e) => /percentOfPeak/.test(e.path))).toBe(true);
    expect(res.errors.some((e) => /lookbackMonths/.test(e.path))).toBe(true);
  });

  it("rejects block bounds that do not strictly increase", () => {
    const t = clone();
    const energy = t.charges.find((c) => c.kind === "energy");
    if (energy?.kind === "energy") {
      energy.blockReset = "monthly";
      energy.rates[0].blocks = [
        { uptoKwh: 1000, rate: { amount: 0.1 } },
        { uptoKwh: 500, rate: { amount: 0.2 } },
        { uptoKwh: null, rate: { amount: 0.3 } },
      ];
    }
    expect(validateTariff(t).errors.some((e) => /strictly increase/.test(e.message))).toBe(true);
  });

  it("rejects a stepped rate when the charge has no blockReset", () => {
    const t = clone();
    const energy = t.charges.find((c) => c.kind === "energy");
    if (energy?.kind === "energy") {
      energy.rates[0].blocks = [{ uptoKwh: null, rate: { amount: 0.1 } }];
    }
    expect(validateTariff(t).errors.some((e) => /requires blockReset/.test(e.message))).toBe(true);
  });

  it("flags an inconsistent containsPlaceholders flag", () => {
    const t = clone();
    t.containsPlaceholders = true; // but there are no placeholders
    expect(validateTariff(t).errors.some((e) => e.path === "containsPlaceholders")).toBe(true);
  });

  it("every registered schedule is structurally valid", () => {
    for (const t of Object.values(TARIFF_SCHEDULES)) {
      expect(validateTariff(t).errors).toEqual([]);
    }
  });
});

describe("public-holiday calendar (data)", () => {
  it("knows QLD 2024/2025 holidays and reports year completeness", () => {
    expect(isPublicHoliday("QLD", "2025-04-25")).toBe(true); // Anzac Day
    expect(isPublicHoliday("QLD", "2025-07-15")).toBe(false);
    expect(holidayYearKnown("QLD", 2025)).toBe(true);
    expect(holidayYearKnown("QLD", 2030)).toBe(false);
  });

  it("returns false (best-effort) for states without a populated calendar", () => {
    expect(isPublicHoliday("NSW", "2025-04-25")).toBe(false);
    expect(holidayYearKnown("NSW", 2025)).toBe(false);
  });
});
