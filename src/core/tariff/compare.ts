import type { AnalyticsReading } from "@/core/analytics/types";
import type { Tariff, LossFactors, CostResult } from "@/core/tariff/types";
import { computeCost } from "@/core/tariff/engine";

export interface TariffOption {
  tariff: Tariff;
  cost: CostResult;
}

/**
 * Cost the same interval data under several tariffs and rank cheapest-first. This is the
 * "should the client switch tariff?" analysis — the engine is tariff-agnostic, so it's
 * just costing the same data N ways. Eligibility (e.g. connection voltage) is a separate
 * real-world constraint the report must flag; this only computes the dollars.
 */
export function compareTariffs(
  readings: ReadonlyArray<AnalyticsReading>,
  tariffs: ReadonlyArray<Tariff>,
  losses: LossFactors = {},
): TariffOption[] {
  return tariffs
    .map((tariff) => ({ tariff, cost: computeCost(readings, tariff, losses) }))
    .sort((a, b) => a.cost.total - b.cost.total);
}
