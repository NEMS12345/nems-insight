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
