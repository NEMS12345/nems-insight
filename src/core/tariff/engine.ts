import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind, intervalPowerKw } from "@/core/analytics/types";
import { aestDate, aestYearMonth } from "@/core/analytics/time";
import type {
  Tariff,
  TouPeriod,
  CostResult,
  CostLine,
} from "@/core/tariff/types";
import { classifyPeriod } from "@/core/tariff/periods";

interface IntervalDemand {
  kw: number;
  period: TouPeriod;
  month: string;
}

function emptyByPeriod(): Record<TouPeriod, number> {
  return { peak: 0, shoulder: 0, offpeak: 0 };
}

/**
 * Compute the modelled cost of a set of interval readings under a tariff. Pure: it takes
 * data + a tariff and returns a costed breakdown. Consumption (E channels) drives energy
 * and demand; export/reactive are ignored here (export crediting is out of v1 scope).
 *
 * Days are derived from the distinct AEST dates present, and demand is the maximum 30-minute
 * interval demand within each charge's period, per calendar month — exactly the Energex rule.
 */
export function computeCost(
  readings: ReadonlyArray<AnalyticsReading>,
  tariff: Tariff,
): CostResult {
  const energyByPeriod = emptyByPeriod();
  const days = new Set<string>();

  // Sum consumption energy per interval (multiple E channels combine), then derive power.
  const perInterval = new Map<string, { kwh: number; length: number }>();
  for (const r of readings) {
    if (channelKind(r.channel) !== "consumption") continue;
    days.add(aestDate(r.intervalStart));
    const slot = perInterval.get(r.intervalStart);
    if (slot) slot.kwh += r.value;
    else perInterval.set(r.intervalStart, { kwh: r.value, length: r.intervalLength });
  }

  const demand: IntervalDemand[] = [];
  for (const [intervalStart, { kwh, length }] of perInterval) {
    const period = classifyPeriod(intervalStart, tariff.periods);
    energyByPeriod[period] += kwh;
    demand.push({
      kw: intervalPowerKw(kwh, length),
      period,
      month: aestYearMonth(intervalStart),
    });
  }

  const dayCount = days.size;
  const totalEnergy =
    energyByPeriod.peak + energyByPeriod.shoulder + energyByPeriod.offpeak;

  const lines: CostLine[] = [];

  for (const charge of tariff.charges) {
    if (charge.kind === "fixed_daily") {
      lines.push({
        label: charge.label,
        category: charge.category,
        amount: charge.ratePerDay * dayCount,
        detail: `${dayCount} days @ $${charge.ratePerDay}/day`,
      });
    } else if (charge.kind === "energy") {
      const kwh = charge.period === "all" ? totalEnergy : energyByPeriod[charge.period];
      lines.push({
        label: charge.label,
        category: charge.category,
        amount: charge.rate * kwh,
        detail: `${Math.round(kwh).toLocaleString("en-AU")} kWh @ $${charge.rate}/kWh`,
      });
    } else {
      // demand_monthly: sum each calendar month's maximum in-window demand.
      const monthlyMax = new Map<string, number>();
      for (const d of demand) {
        if (d.period !== charge.period) continue;
        const prev = monthlyMax.get(d.month) ?? 0;
        if (d.kw > prev) monthlyMax.set(d.month, d.kw);
      }
      const summedMax = [...monthlyMax.values()].reduce((s, v) => s + v, 0);
      const months = monthlyMax.size;
      lines.push({
        label: charge.label,
        category: charge.category,
        amount: charge.rate * summedMax,
        detail:
          months === 0
            ? "no in-window demand"
            : `${months} month${months === 1 ? "" : "s"}, summed max ${summedMax.toFixed(1)} ${charge.unit} @ $${charge.rate}/${charge.unit}/month`,
      });
    }
  }

  const networkTotal = lines
    .filter((l) => l.category === "network")
    .reduce((s, l) => s + l.amount, 0);
  const retailTotal = lines
    .filter((l) => l.category === "retail")
    .reduce((s, l) => s + l.amount, 0);

  return {
    currency: tariff.currency,
    lines,
    networkTotal,
    retailTotal,
    total: networkTotal + retailTotal,
    days: dayCount,
    energyByPeriod,
  };
}
