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
