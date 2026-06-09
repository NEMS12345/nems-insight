// Tariff model — tariffs are DATA, not if/else code. A Tariff is a declarative description
// of charges that the engine (engine.ts) applies to interval data. Adding another network
// or retailer means adding another Tariff value, not changing the engine.

import type { ComponentKind } from "@/core/reconciliation/taxonomy";

export type Category = "network" | "retail";

export type TouPeriod = "peak" | "shoulder" | "offpeak";

/** Energy charges may apply to a specific time-of-use period or to all energy (flat). */
export type EnergyPeriod = TouPeriod | "all";

export type DayType = "weekday" | "weekend";

/** A half-open minute range within a day, AEST. [startMin, endMin). */
export interface TimeRange {
  startMin: number;
  endMin: number;
}

export interface PeriodWindow {
  dayTypes: DayType[];
  ranges: TimeRange[];
}

/**
 * How to classify an interval into a time-of-use period. Precedence: an interval is
 * off-peak if it matches the off-peak window, else peak if it matches the peak window,
 * else shoulder (the catch-all). This mirrors how the Energex guide defines shoulder as
 * "everything that isn't peak or off-peak".
 */
export interface PeriodDefinition {
  offpeak: PeriodWindow;
  peak: PeriodWindow;
}

export type Charge =
  | {
      kind: "fixed_daily";
      category: Category;
      label: string;
      ratePerDay: number; // $/day
    }
  | {
      kind: "fixed_monthly";
      category: Category;
      label: string;
      ratePerMonth: number; // $/calendar month (e.g. connection-unit charges)
    }
  | {
      kind: "energy";
      category: Category;
      label: string;
      period: EnergyPeriod;
      rate: number; // $/kWh (raw, before loss factors)
      /** Loss factors applied to this charge's energy (e.g. ["MLF","DLF"]). */
      losses?: LossFactor[];
    }
  | {
      kind: "demand_monthly";
      category: Category;
      label: string;
      period: TouPeriod; // demand measured within this period's window (unless `window` set)
      unit: "kW" | "kVA";
      rate: number; // $/unit/month, charged on the monthly maximum interval demand in-window
      /** Explicit demand window, when it differs from the energy period windows. */
      window?: PeriodWindow;
    };

export type LossFactor = "MLF" | "DLF";

export interface LossFactors {
  mlf?: number; // marginal loss factor (default 1)
  dlf?: number; // distribution loss factor (default 1)
  /**
   * Assumed power factor for deriving kVA demand when the dataset has NO reactive channel.
   * If absent and a kVA-demand charge is hit without reactive data, kVA falls back to kW
   * (understated) — the report must flag this rather than present it as fact.
   */
  assumedPf?: number;
}

export type VoltageClass = "LV" | "HV";

export interface TariffEligibility {
  minAnnualMwh?: number;
  maxAnnualMwh?: number;
}

export interface Tariff {
  code: string;
  name: string;
  network: string; // DNSP, e.g. "Energex"
  currency: "AUD";
  /** Connection voltage this tariff requires — a physical eligibility constraint. */
  voltageClass: VoltageClass;
  /** Consumption thresholds for eligibility, if any. */
  eligibility?: TariffEligibility;
  /** True if some charges are estimates (e.g. retail) rather than published network rates. */
  hasEstimatedCharges: boolean;
  periods: PeriodDefinition;
  charges: Charge[];
}

export interface CostLine {
  label: string;
  category: Category;
  amount: number;
  detail?: string;
  /** Reconciliation-taxonomy kind this line maps to, set where the charge is costed. */
  component?: ComponentKind;
  /** Sub-bucket within the component — for energy, the ToU period ("peak") or "all". */
  subKey?: string;
}

export interface CostResult {
  currency: "AUD";
  lines: CostLine[];
  networkTotal: number;
  retailTotal: number;
  total: number;
  days: number;
  energyByPeriod: Record<TouPeriod, number>; // kWh
}
