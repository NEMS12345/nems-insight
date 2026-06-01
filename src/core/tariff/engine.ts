import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind, intervalPowerKw } from "@/core/analytics/types";
import { aestDate, aestYearMonth } from "@/core/analytics/time";
import type {
  Tariff,
  TouPeriod,
  CostResult,
  CostLine,
  LossFactors,
} from "@/core/tariff/types";
import { classifyPeriod, inWindow } from "@/core/tariff/periods";

interface IntervalDemand {
  intervalStart: string;
  kw: number;
  kva: number;
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
  losses: LossFactors = {},
): CostResult {
  const mlf = losses.mlf ?? 1;
  const dlf = losses.dlf ?? 1;
  const energyByPeriod = emptyByPeriod();
  const days = new Set<string>();
  const months = new Set<string>();

  // Sum consumption (E) and reactive (Q) energy per interval; export is ignored for cost.
  const perInterval = new Map<string, { kwh: number; kvarh: number; length: number }>();
  for (const r of readings) {
    const kind = channelKind(r.channel);
    if (kind !== "consumption" && kind !== "reactive") continue;
    days.add(aestDate(r.intervalStart));
    months.add(aestYearMonth(r.intervalStart));
    const slot =
      perInterval.get(r.intervalStart) ??
      { kwh: 0, kvarh: 0, length: r.intervalLength };
    if (kind === "consumption") slot.kwh += r.value;
    else slot.kvarh += r.value;
    perInterval.set(r.intervalStart, slot);
  }

  const demand: IntervalDemand[] = [];
  for (const [intervalStart, { kwh, kvarh, length }] of perInterval) {
    const period = classifyPeriod(intervalStart, tariff.periods);
    energyByPeriod[period] += kwh;
    const kw = intervalPowerKw(kwh, length);
    const kvar = intervalPowerKw(kvarh, length);
    demand.push({
      intervalStart,
      kw,
      kva: Math.sqrt(kw * kw + kvar * kvar), // apparent power; == kw when no reactive data
      period,
      month: aestYearMonth(intervalStart),
    });
  }

  const dayCount = days.size;
  const monthCount = months.size;
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
    } else if (charge.kind === "fixed_monthly") {
      lines.push({
        label: charge.label,
        category: charge.category,
        amount: charge.ratePerMonth * monthCount,
        detail: `${monthCount} month${monthCount === 1 ? "" : "s"} @ $${charge.ratePerMonth}/month`,
      });
    } else if (charge.kind === "energy") {
      const kwh = charge.period === "all" ? totalEnergy : energyByPeriod[charge.period];
      const lossMult = (charge.losses ?? []).reduce(
        (m, lf) => m * (lf === "MLF" ? mlf : dlf),
        1,
      );
      const lossNote =
        charge.losses && charge.losses.length > 0
          ? ` × ${charge.losses.join("×")}`
          : "";
      lines.push({
        label: charge.label,
        category: charge.category,
        amount: charge.rate * kwh * lossMult,
        detail: `${Math.round(kwh).toLocaleString("en-AU")} kWh @ $${charge.rate}/kWh${lossNote}`,
      });
    } else {
      // demand_monthly: sum each calendar month's maximum in-window demand,
      // measured in kVA (apparent power) or kW (real power) per the charge.
      const monthlyMax = new Map<string, number>();
      for (const d of demand) {
        const inScope = charge.window
          ? inWindow(d.intervalStart, charge.window)
          : d.period === charge.period;
        if (!inScope) continue;
        const value = charge.unit === "kVA" ? d.kva : d.kw;
        const prev = monthlyMax.get(d.month) ?? 0;
        if (value > prev) monthlyMax.set(d.month, value);
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
