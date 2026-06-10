// Savings register — the consolidated table clients circulate internally. Pure assembly:
// callers build items from the various findings (tariff switch, solar, PF, demand, retail
// benchmark, operational), and this orders/totals them.

export type Confidence = "high" | "medium" | "low";

export interface SavingsItem {
  measure: string;
  annualSavingAud: number;
  indicativeCapexAud: number | null;
  paybackYears: number | null;
  confidence: Confidence;
  note?: string;
}

/** Sort a register most-valuable-first. */
export function sortSavings(items: SavingsItem[]): SavingsItem[] {
  return [...items].sort((a, b) => b.annualSavingAud - a.annualSavingAud);
}

export function totalAnnualSaving(items: ReadonlyArray<SavingsItem>): number {
  return items.reduce((sum, i) => sum + i.annualSavingAud, 0);
}

export interface IssueCheck {
  /** "block" stops client-facing issue; "flag" warns but allows it. */
  level: "block" | "flag";
  message: string;
}

export interface PreIssueContext {
  lossesEntered: boolean;
  connectionVoltageSet: boolean;
  retailPlanCustom: boolean; // false = using the default plan, not the client's contract
  retailDailyChargeTotal: number; // supply + metering, $/day
  assumedPf: number | null;
  hasReactive: boolean;
  kvaBilled: boolean;
  peakKw: number;
  /** Tariff has a connection-unit charge but the NMI's unit count isn't set (→ modelled $0). */
  connectionUnitChargeUnset: boolean;
}

/**
 * Pre-issue completeness & plausibility gate (operator guardrail). Returns every failed or
 * flagged check; any "block" means the report cannot go client-facing. Catches the things
 * that previously slipped through: blank loss factors, missing voltage, implausible retail
 * supply charge, out-of-range PF, zero demand.
 */
export function preIssueChecks(ctx: PreIssueContext): IssueCheck[] {
  const checks: IssueCheck[] = [];
  const block = (message: string) => checks.push({ level: "block", message });
  const flag = (message: string) => checks.push({ level: "flag", message });

  if (!ctx.lossesEntered) {
    block("Loss factors (MLF/DLF) not entered — cost model and benchmark exclude losses and understate actual cost.");
  }
  if (ctx.kvaBilled && !ctx.hasReactive && ctx.assumedPf == null) {
    block("kVA-demand tariff but no reactive data and no assumed PF — demand cost can't be determined.");
  }
  if (ctx.connectionUnitChargeUnset) {
    block("Tariff has a connection unit charge but the NMI's connection-unit count isn't set — that charge is modelled as $0 and understates cost.");
  }
  if (ctx.assumedPf != null && (ctx.assumedPf <= 0 || ctx.assumedPf > 1)) {
    block(`Assumed power factor (${ctx.assumedPf}) is outside (0, 1].`);
  }
  if (ctx.peakKw <= 0) {
    block("Peak demand is zero or negative — check the interval data.");
  }
  if (!ctx.connectionVoltageSet) {
    flag("Connection voltage not set — tariff comparison limited to the current voltage class.");
  }
  if (!ctx.retailPlanCustom) {
    flag("Retail plan is using default rates — enter the client's actual contract.");
  }
  if (ctx.retailDailyChargeTotal < 0.1) {
    flag(`Retail supply/metering charge is implausibly low ($${ctx.retailDailyChargeTotal.toFixed(2)}/day) — check the inputs.`);
  } else if (ctx.retailDailyChargeTotal > 50) {
    flag(`Retail supply/metering charge is implausibly high ($${ctx.retailDailyChargeTotal.toFixed(2)}/day) — check the inputs.`);
  }
  return checks;
}

const RANK: Confidence[] = ["high", "medium", "low"];

/**
 * Downgrade a confidence rating when the underlying data is weak — a partial/one-season
 * window or a high estimated/substituted share. Ties data quality directly to confidence.
 */
export function adjustConfidence(
  base: Confidence,
  opts: { seasonalCaveat: boolean; estimatedFraction: number },
): Confidence {
  let idx = RANK.indexOf(base);
  if (opts.seasonalCaveat) idx++;
  if (opts.estimatedFraction > 0.1) idx++;
  return RANK[Math.min(idx, RANK.length - 1)];
}
