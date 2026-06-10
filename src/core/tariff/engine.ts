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
/**
 * The marginal energy cost of one more (or one fewer) kWh in a given period, $/kWh —
 * the sum of energy-charge rates that apply to that period (incl. flat "all" charges),
 * with loss factors. Used to value solar self-consumption (daytime ≈ peak).
 */
export function marginalEnergyRatePerKwh(
  tariff: Tariff,
  period: TouPeriod,
  losses: LossFactors = {},
): number {
  const mlf = losses.mlf ?? 1;
  const dlf = losses.dlf ?? 1;
  let rate = 0;
  for (const charge of tariff.charges) {
    if (charge.kind !== "energy") continue;
    if (charge.period !== "all" && charge.period !== period) continue;
    const lossMult = (charge.losses ?? []).reduce(
      (m, lf) => m * (lf === "MLF" ? mlf : dlf),
      1,
    );
    rate += charge.rate * lossMult;
  }
  return rate;
}

export function computeCost(
  readings: ReadonlyArray<AnalyticsReading>,
  tariff: Tariff,
  losses: LossFactors = {},
): CostResult {
  const mlf = losses.mlf ?? 1;
  const dlf = losses.dlf ?? 1;
  const assumedPf = losses.assumedPf;
  const energyByPeriod = emptyByPeriod();
  const days = new Set<string>();
  const months = new Set<string>();
  let hasReactive = false;

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
    else {
      slot.kvarh += r.value;
      hasReactive = true;
    }
    perInterval.set(r.intervalStart, slot);
  }

  const demand: IntervalDemand[] = [];
  for (const [intervalStart, { kwh, kvarh, length }] of perInterval) {
    const period = classifyPeriod(intervalStart, tariff.periods);
    energyByPeriod[period] += kwh;
    const kw = intervalPowerKw(kwh, length);
    // kVA: from reactive when available; else from an explicit assumed PF; else fall back to
    // kW (understated — the report flags this rather than presenting it as fact).
    const kva = hasReactive
      ? Math.sqrt(kw * kw + intervalPowerKw(kvarh, length) ** 2)
      : assumedPf != null && assumedPf > 0
        ? kw / assumedPf
        : kw;
    demand.push({ intervalStart, kw, kva, period, month: aestYearMonth(intervalStart) });
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
        component: "supply",
      });
    } else if (charge.kind === "fixed_monthly") {
      lines.push({
        label: charge.label,
        category: charge.category,
        amount: charge.ratePerMonth * monthCount,
        detail: `${monthCount} month${monthCount === 1 ? "" : "s"} @ $${charge.ratePerMonth}/month`,
        component: "supply",
      });
    } else if (charge.kind === "connection_unit") {
      // Per-unit charge: ratePerUnit × the externally-supplied count (per-NMI/per-bill data).
      const units = losses.connectionUnits ?? 0;
      lines.push({
        label: charge.label,
        category: charge.category,
        amount: charge.ratePerUnit * units,
        detail:
          units > 0
            ? `${units} units @ $${charge.ratePerUnit}/unit`
            : "connection-unit count not set — modelled as $0",
        component: "supply",
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
        component: "energy",
        subKey: charge.period,
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
        component: "demand",
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
