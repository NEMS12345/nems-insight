// General network-tariff schema — tariffs are DATA, not code.
//
// This schema is deliberately general enough to express ANY NEM distribution network's
// (DNSP) published tariff structure: standing charges, flat or time-of-use energy with
// seasonal and day-type variation, kW/kVA demand with chargeable windows / reset periods /
// ratchets, stepped (block) rates, controlled-load (separate) tariffs, and import vs export
// directions. Every schedule is effective-dated and carries provenance.
//
// This is the SCHEMA + DATA + VALIDATION only. The cost engine that applies a schema to
// interval data is Phase 4 — it is intentionally NOT built here. Keeping the schema general
// now means a new DNSP is a new data value, never an engine rewrite.
//
// Pure TypeScript — no DB/framework/other-layer imports (CLAUDE.md §3).
//
// NOTE: this lives alongside the existing v1 tariff model (src/core/tariff/types.ts), which
// the current engine still uses. This general schema is the forward-looking target; the two
// will converge in Phase 4. Nothing here changes the existing engine.

import type { LossFactor, VoltageClass, TariffEligibility } from "@/core/tariff/types";

export type { LossFactor, VoltageClass, TariffEligibility };

export type Currency = "AUD";

/** Australian states/territories — selects the public-holiday calendar. */
export type AustralianState =
  | "QLD"
  | "NSW"
  | "VIC"
  | "SA"
  | "WA"
  | "TAS"
  | "ACT"
  | "NT";

/** Energy can flow into the premises (import/consumption) or out (export/feed-in). */
export type ChargeDirection = "import" | "export";

/** Demand can be measured in real power (kW) or apparent power (kVA). */
export type DemandUnit = "kW" | "kVA";

/** How often a demand maximum or a stepped-rate block counter resets. */
export type ResetPeriod = "daily" | "monthly" | "annual";

/**
 * Day classification for time-of-use. Public holidays are first-class because most DNSPs
 * treat them as off-peak/weekend regardless of which weekday they fall on.
 */
export type DayTypeClass = "weekday" | "weekend" | "public-holiday";

/**
 * A single rate figure. Real published figures carry provenance on the parent tariff and
 * leave `placeholder`/`todo` unset. Structure-only fixtures set `placeholder: true` and a
 * `todo` naming the published schedule the real number must come from — so a placeholder can
 * never be mistaken for authoritative pricing.
 */
export interface RateValue {
  amount: number;
  placeholder?: boolean;
  /** What to source, from where, e.g. "Ausgrid EA116 schedule, effective 2024-07-01". */
  todo?: string;
}

/** Provenance for the whole schedule — where the real figures came from and when they apply. */
export interface Provenance {
  source: string; // DNSP / retailer / document name
  effectiveFrom: string; // ISO date "YYYY-MM-DD"
  effectiveTo?: string; // ISO date; omit for "current"
  note?: string;
}

/**
 * A season is a named set of month ranges (1–12 inclusive). A range wraps across the year
 * end when `fromMonth > toMonth` (e.g. summer Nov–Mar = {fromMonth: 11, toMonth: 3}).
 */
export interface Season {
  id: string;
  label: string;
  monthRanges: { fromMonth: number; toMonth: number }[];
}

/** A half-open minute-of-day window [startMin, endMin), local clock time. 0 ≤ s < e ≤ 1440. */
export interface TimeWindow {
  startMin: number;
  endMin: number;
}

/** One step of a stepped/block rate. `uptoKwh: null` is the final, unbounded block. */
export interface EnergyBlock {
  uptoKwh: number | null;
  rate: RateValue; // $/kWh
}

/**
 * One time-of-use energy rate. A flat (non-ToU) tariff has a single EnergyRate with
 * `touId: "flat"`, all day-types, and no `windows`. Seasonal ToU repeats rates per season.
 */
export interface EnergyRate {
  touId: string; // "peak" | "shoulder" | "offpeak" | "flat" | custom
  label: string;
  dayTypes: DayTypeClass[];
  /** Season this rate applies in; omit = all year. Must reference a Season on the tariff. */
  seasonId?: string;
  /** Windows within a day; omit/empty = applies all day (flat or whole-day rate). */
  windows?: TimeWindow[];
  /** Per-kWh rate; ignored when `blocks` is present. */
  rate: RateValue;
  /** Stepped/block pricing — overrides `rate`. Counter resets per the charge's reset period. */
  blocks?: EnergyBlock[];
  /** Loss factors applied to this rate's energy (e.g. ["MLF","DLF"]). */
  losses?: LossFactor[];
}

/** A daily standing/supply/fixed charge. */
export interface StandingCharge {
  kind: "standing";
  label: string;
  ratePerDay: RateValue; // $/day
}

/** A monthly fixed charge (e.g. a connection-unit charge). */
export interface MonthlyFixedCharge {
  kind: "monthly_fixed";
  label: string;
  ratePerMonth: RateValue; // $/calendar month
}

/**
 * An energy (volume) charge. `scope: "controlled-load"` models a separate controlled-load
 * tariff metered on its own channel. `direction: "export"` models a feed-in/export charge.
 */
export interface EnergyCharge {
  kind: "energy";
  label: string;
  direction: ChargeDirection;
  scope: "main" | "controlled-load";
  /** Reset period for stepped/block counters; required when any rate uses `blocks`. */
  blockReset?: ResetPeriod;
  rates: EnergyRate[];
}

/**
 * A demand ratchet: the chargeable demand is the HIGHER of the current period's measured
 * demand and `percentOfPeak`% of the maximum demand recorded over the last `lookbackMonths`
 * months. Optionally only enforced in a given season (e.g. a winter ratchet).
 */
export interface DemandRatchet {
  percentOfPeak: number; // 0–100
  lookbackMonths: number; // > 0
  appliesInSeasonId?: string;
}

/** A demand charge (kW or kVA), with chargeable window, aggregation, reset and ratchet. */
export interface DemandCharge {
  kind: "demand";
  label: string;
  unit: DemandUnit;
  rate: RateValue; // $/unit per reset period
  reset: ResetPeriod;
  /** Where (day-types / season / windows) the chargeable demand is measured. */
  measurement: {
    dayTypes: DayTypeClass[];
    seasonId?: string;
    /** Chargeable windows; omit/empty = any time (anytime maximum demand). */
    windows?: TimeWindow[];
  };
  /** How the demand figure is derived from intervals within the window. */
  aggregation: "max-interval";
  ratchet?: DemandRatchet;
  losses?: LossFactor[];
}

export type Charge =
  | StandingCharge
  | MonthlyFixedCharge
  | EnergyCharge
  | DemandCharge;

/** A complete, effective-dated network tariff for one DNSP. */
export interface NetworkTariffSchema {
  schemaVersion: 1;
  code: string;
  name: string;
  network: string; // DNSP, e.g. "Energex"
  state: AustralianState; // selects the public-holiday calendar
  currency: Currency;
  voltageClass: VoltageClass;
  eligibility?: TariffEligibility;
  provenance: Provenance;
  /** Named seasons referenced by energy/demand rates; empty = no seasonal differentiation. */
  seasons: Season[];
  charges: Charge[];
  /**
   * True when ANY rate in the schedule is a placeholder (a structure-only fixture). The
   * validator checks this flag is consistent with the data, so a populated tariff can never
   * silently hide a placeholder.
   */
  containsPlaceholders: boolean;
}
