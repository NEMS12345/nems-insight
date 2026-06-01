// Tariff model — tariffs are DATA, not if/else code. A Tariff is a declarative description
// of charges that the engine (engine.ts) applies to interval data. Adding another network
// or retailer means adding another Tariff value, not changing the engine.

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
      rate: number; // $/kWh
    }
  | {
      kind: "demand_monthly";
      category: Category;
      label: string;
      period: TouPeriod; // demand is measured within this period's window
      unit: "kW" | "kVA";
      rate: number; // $/unit/month, charged on the monthly maximum interval demand in-window
    };

export interface Tariff {
  code: string;
  name: string;
  network: string; // DNSP, e.g. "Energex"
  currency: "AUD";
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
