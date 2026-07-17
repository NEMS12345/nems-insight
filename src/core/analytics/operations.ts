import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind, intervalPowerKw } from "@/core/analytics/types";
import {
  aestDate,
  aestDayType,
  aestMinuteOfDay,
  aestYearMonth,
} from "@/core/analytics/time";

export interface OperationsFindings {
  /** Typical overnight (00:00–05:00) standing demand, kW. */
  baseLoadKw: number;
  /** Base load as a fraction of peak demand (high = lots of always-on load). */
  baseLoadFractionOfPeak: number;
  /**
   * AVOIDABLE portion of base load, kW — observed base load minus an assumed essential
   * floor (refrigeration/servers/security legitimately run overnight). Conservative: only
   * this part should be dollarised, pending site confirmation.
   */
  avoidableBaseLoadKw: number;
  /** Average daily consumption on weekdays, kWh. */
  weekdayDailyKwh: number;
  /** Average daily consumption on weekends, kWh. */
  weekendDailyKwh: number;
  /** Weekend daily use as a fraction of weekday daily use (high = running when likely closed). */
  weekendFractionOfWeekday: number;
  /** Fraction of consumption energy outside business hours (before 7am / after 6pm, and weekends). */
  outOfHoursFraction: number;
  /** Fraction of TIME outside business hours (for estimating avoidable run-hours). */
  outOfHoursTimeFraction: number;
  /** Change in monthly base load from first to last month (fraction; +ve = creep up). */
  baseLoadCreep: number | null;
}

/** Assumed share of overnight base load that is essential (not avoidable). Conservative. */
export const DEFAULT_ESSENTIAL_BASE_FRACTION = 0.6;

const OVERNIGHT_START = 0;
const OVERNIGHT_END = 5 * 60;
const BUSINESS_START = 7 * 60;
const BUSINESS_END = 18 * 60;

/**
 * Operational / consumption-anomaly findings from interval data — the zero-capex "free
 * wins" section: standing overnight load, weekend running, out-of-hours use, and base-load
 * creep over time.
 */
export function analyseOperations(
  readings: ReadonlyArray<AnalyticsReading>,
  essentialBaseFraction: number = DEFAULT_ESSENTIAL_BASE_FRACTION,
): OperationsFindings {
  let total = 0;
  let outOfHours = 0;
  let peakKw = 0;
  let intervalCount = 0;
  let outOfHoursIntervals = 0;

  const overnightKwByMonth = new Map<string, { sum: number; n: number }>();
  const dailyKwh = new Map<string, { kwh: number; dayType: "weekday" | "weekend" }>();

  for (const r of readings) {
    if (channelKind(r.channel) !== "consumption") continue;
    const minute = aestMinuteOfDay(r.intervalStart);
    const dayType = aestDayType(r.intervalStart);

    total += r.value;
    intervalCount++;
    const businessHours =
      dayType === "weekday" && minute >= BUSINESS_START && minute < BUSINESS_END;
    if (!businessHours) {
      outOfHours += r.value;
      outOfHoursIntervals++;
    }

    const kw = intervalPowerKw(r.value, r.intervalLength);
    if (kw > peakKw) peakKw = kw;

    if (minute >= OVERNIGHT_START && minute < OVERNIGHT_END) {
      const ym = aestYearMonth(r.intervalStart);
      const slot = overnightKwByMonth.get(ym) ?? { sum: 0, n: 0 };
      slot.sum += kw;
      slot.n += 1;
      overnightKwByMonth.set(ym, slot);
    }

    const date = aestDate(r.intervalStart);
    const d = dailyKwh.get(date) ?? { kwh: 0, dayType };
    d.kwh += r.value;
    dailyKwh.set(date, d);
  }

  // Overnight base load (averaged across all overnight intervals).
  let overnightSum = 0;
  let overnightN = 0;
  for (const { sum, n } of overnightKwByMonth.values()) {
    overnightSum += sum;
    overnightN += n;
  }
  const baseLoadKw = overnightN === 0 ? 0 : overnightSum / overnightN;

  // Weekday vs weekend daily averages.
  let wdSum = 0,
    wdN = 0,
    weSum = 0,
    weN = 0;
  for (const { kwh, dayType } of dailyKwh.values()) {
    if (dayType === "weekday") {
      wdSum += kwh;
      wdN += 1;
    } else {
      weSum += kwh;
      weN += 1;
    }
  }
  const weekdayDailyKwh = wdN === 0 ? 0 : wdSum / wdN;
  const weekendDailyKwh = weN === 0 ? 0 : weSum / weN;

  // Base-load creep: first vs last month overnight average.
  const months = [...overnightKwByMonth.keys()].sort();
  let baseLoadCreep: number | null = null;
  if (months.length >= 2) {
    const first = overnightKwByMonth.get(months[0])!;
    const last = overnightKwByMonth.get(months[months.length - 1])!;
    const firstAvg = first.sum / first.n;
    const lastAvg = last.sum / last.n;
    baseLoadCreep = firstAvg === 0 ? null : (lastAvg - firstAvg) / firstAvg;
  }

  return {
    baseLoadKw,
    baseLoadFractionOfPeak: peakKw === 0 ? 0 : baseLoadKw / peakKw,
    avoidableBaseLoadKw: baseLoadKw * (1 - essentialBaseFraction),
    weekdayDailyKwh,
    weekendDailyKwh,
    weekendFractionOfWeekday:
      weekdayDailyKwh === 0 ? 0 : weekendDailyKwh / weekdayDailyKwh,
    outOfHoursFraction: total === 0 ? 0 : outOfHours / total,
    outOfHoursTimeFraction: intervalCount === 0 ? 0 : outOfHoursIntervals / intervalCount,
    baseLoadCreep,
  };
}
