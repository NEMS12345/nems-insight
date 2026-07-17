import type { AnalyticsReading } from "@/core/analytics/types";
import { aestDate } from "@/core/analytics/time";
import { computeCost } from "@/core/tariff/engine";
import { computeRetailCost, type RetailPlan } from "@/core/tariff/retail";
import type {
  CostLine,
  CostResult,
  LossFactors,
  Tariff,
  TouPeriod,
} from "@/core/tariff/types";

export interface PricingPeriod<T> {
  start: string;
  end: string;
  rates: T;
}

function inclusiveDays(start: string, end: string): number {
  return Math.floor(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  ) + 1;
}

function readingsFor<T>(
  readings: ReadonlyArray<AnalyticsReading>,
  period: PricingPeriod<T>,
): AnalyticsReading[] {
  return readings.filter((reading) => {
    const date = aestDate(reading.intervalStart);
    return date >= period.start && date <= period.end;
  });
}

function addLine(lines: Map<string, CostLine>, line: CostLine): void {
  const key = [line.category, line.component ?? "", line.subKey ?? "", line.label].join("|");
  const current = lines.get(key);
  if (current) {
    current.amount += line.amount;
    current.detail = "Effective-dated pricing applied across the data period";
  } else {
    lines.set(key, { ...line });
  }
}

function emptyEnergy(): Record<TouPeriod, number> {
  return { peak: 0, shoulder: 0, offpeak: 0 };
}

/**
 * Cost a historical interval-data window using the network and retail rates effective on
 * each date. Network rate changes must begin on a calendar-month boundary because demand
 * is a monthly maximum; inventing a mid-month proration would create an unsupported bill.
 * Retail versions can change on any date because their charges are interval- or day-based.
 */
export function computeVersionedFullCost(
  readings: ReadonlyArray<AnalyticsReading>,
  networkPeriods: ReadonlyArray<PricingPeriod<Tariff>>,
  retailPeriods: ReadonlyArray<PricingPeriod<RetailPlan>>,
  losses: LossFactors = {},
): CostResult {
  if (networkPeriods.length === 0 || retailPeriods.length === 0) {
    throw new Error("Effective-dated network and retail pricing are required.");
  }
  for (const period of networkPeriods.slice(1)) {
    if (!period.start.endsWith("-01")) {
      throw new Error(
        `Network pricing changes on ${period.start}, inside a demand month. ` +
          "Confirm the retailer's demand-charge treatment before reconciling this period.",
      );
    }
  }

  const lines = new Map<string, CostLine>();
  const energyByPeriod = emptyEnergy();
  let networkTotal = 0;
  let retailTotal = 0;
  const totalNetworkDays = networkPeriods.reduce(
    (sum, period) => sum + inclusiveDays(period.start, period.end),
    0,
  );

  for (const period of networkPeriods) {
    const periodReadings = readingsFor(readings, period);
    const result = computeCost(periodReadings, period.rates, {
      ...losses,
      // A connection-unit count is per bill, so it is handled once below using a
      // day-weighted effective rate rather than being repeated for every version.
      connectionUnits: undefined,
    });
    const connectionLabels = new Set(
      period.rates.charges
        .filter((charge) => charge.kind === "connection_unit")
        .map((charge) => charge.label),
    );
    for (const line of result.lines) {
      if (!connectionLabels.has(line.label)) {
        addLine(lines, line);
        networkTotal += line.amount;
      }
    }
    for (const tou of Object.keys(energyByPeriod) as TouPeriod[]) {
      energyByPeriod[tou] += result.energyByPeriod[tou];
    }

    const weight = inclusiveDays(period.start, period.end) / totalNetworkDays;
    for (const charge of period.rates.charges) {
      if (charge.kind !== "connection_unit") continue;
      const amount = charge.ratePerUnit * (losses.connectionUnits ?? 0) * weight;
      addLine(lines, {
        label: charge.label,
        category: charge.category,
        amount,
        detail:
          losses.connectionUnits == null
            ? "connection-unit count not set — modelled as $0"
            : `${losses.connectionUnits} units; effective rate weighted by bill days`,
        component: "supply",
      });
      networkTotal += amount;
    }
  }

  for (const period of retailPeriods) {
    const result = computeRetailCost(readingsFor(readings, period), period.rates, losses);
    for (const line of result.lines) addLine(lines, line);
    retailTotal += result.total;
  }

  const dates = new Set(readings.map((reading) => aestDate(reading.intervalStart)));
  return {
    currency: networkPeriods[0].rates.currency,
    lines: [...lines.values()],
    networkTotal,
    retailTotal,
    total: networkTotal + retailTotal,
    days: dates.size,
    energyByPeriod,
  };
}
