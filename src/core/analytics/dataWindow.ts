import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind } from "@/core/analytics/types";
import { aestDate, aestYearMonth } from "@/core/analytics/time";

export interface DataWindow {
  firstDate: string; // YYYY-MM-DD
  lastDate: string;
  days: number;
  months: string[]; // distinct YYYY-MM
  /** Roughly a full year of data (≥ 350 days). */
  spansFullYear: boolean;
  hasSummer: boolean; // Dec/Jan/Feb present
  hasWinter: boolean; // Jun/Jul/Aug present
  /** True when annualised figures should be caveated (partial year / one season). */
  seasonalCaveat: boolean;
  annualisationFactor: number; // 365 / days
}

/**
 * Describe the data window so the report can state it up front and caveat annualised
 * figures. In QLD, HVAC swings consumption/demand seasonally, so annualising off a partial
 * year (e.g. only autumn) overstates or understates — flag it and tie it to confidence.
 */
export function analyseDataWindow(
  readings: ReadonlyArray<AnalyticsReading>,
): DataWindow {
  const dates = new Set<string>();
  const months = new Set<string>();
  for (const r of readings) {
    if (channelKind(r.channel) !== "consumption") continue;
    dates.add(aestDate(r.intervalStart));
    months.add(aestYearMonth(r.intervalStart));
  }

  const sortedDates = [...dates].sort();
  const days = sortedDates.length;
  const monthNums = new Set([...months].map((m) => Number(m.slice(5, 7))));
  const hasSummer = [12, 1, 2].some((m) => monthNums.has(m));
  const hasWinter = [6, 7, 8].some((m) => monthNums.has(m));
  const spansFullYear = days >= 350;

  return {
    firstDate: sortedDates[0] ?? "—",
    lastDate: sortedDates[days - 1] ?? "—",
    days,
    months: [...months].sort(),
    spansFullYear,
    hasSummer,
    hasWinter,
    seasonalCaveat: !(spansFullYear || (hasSummer && hasWinter)),
    annualisationFactor: days > 0 ? 365 / days : 1,
  };
}
