import type { Tariff, VoltageClass } from "@/core/tariff/types";

export interface EligibilityContext {
  /** The NMI's physical connection voltage, or null if not recorded. */
  connectionVoltage: VoltageClass | null;
  /** Tariff code the NMI is currently on (always kept in the eligible set as the baseline). */
  currentCode: string;
  /** Annual consumption (MWh) for threshold checks. */
  annualMwh: number;
}

export interface EligibilityResult {
  tariffs: Tariff[];
  /** True when connection voltage is unknown, so cross-voltage tariffs were excluded. */
  crossVoltageLimited: boolean;
}

/**
 * Filter tariffs to those an NMI is actually eligible for, BEFORE any cost ranking.
 *
 * - Voltage is a physical constraint: an LV NMI can't take an HV tariff and vice versa.
 * - If connection voltage isn't recorded, we do NOT guess — we limit the comparison to the
 *   current tariff's voltage class (no cross-voltage alternatives) and flag it.
 * - The current tariff is always retained as the baseline, even if thresholds don't strictly
 *   pass (it's what the site is on).
 */
export function eligibleTariffs(
  all: ReadonlyArray<Tariff>,
  ctx: EligibilityContext,
): EligibilityResult {
  const current = all.find((t) => t.code === ctx.currentCode) ?? null;
  const targetVoltage = ctx.connectionVoltage ?? current?.voltageClass ?? null;
  const crossVoltageLimited = ctx.connectionVoltage == null;

  const tariffs = all.filter((t) => {
    if (t.code === ctx.currentCode) return true; // baseline always kept
    if (targetVoltage && t.voltageClass !== targetVoltage) return false;
    const e = t.eligibility;
    if (e?.minAnnualMwh != null && ctx.annualMwh < e.minAnnualMwh) return false;
    if (e?.maxAnnualMwh != null && ctx.annualMwh > e.maxAnnualMwh) return false;
    return true;
  });

  return { tariffs, crossVoltageLimited };
}
