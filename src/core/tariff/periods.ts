import type { PeriodDefinition, PeriodWindow, TouPeriod } from "@/core/tariff/types";
import { aestMinuteOfDay, aestDayType } from "@/core/analytics/time";

function windowMatches(
  win: PeriodWindow,
  dayType: "weekday" | "weekend",
  minute: number,
): boolean {
  if (!win.dayTypes.includes(dayType)) return false;
  return win.ranges.some((r) => minute >= r.startMin && minute < r.endMin);
}

/** Whether an interval (by AEST start) falls inside a window. */
export function inWindow(intervalStart: string, win: PeriodWindow): boolean {
  return windowMatches(win, aestDayType(intervalStart), aestMinuteOfDay(intervalStart));
}

/**
 * Classify an interval (by its AEST start time) into a time-of-use period.
 * Off-peak wins, then peak, else shoulder — matching the Energex definition where shoulder
 * is whatever isn't peak or off-peak.
 */
export function classifyPeriod(
  intervalStart: string,
  def: PeriodDefinition,
): TouPeriod {
  const dayType = aestDayType(intervalStart);
  const minute = aestMinuteOfDay(intervalStart);
  if (windowMatches(def.offpeak, dayType, minute)) return "offpeak";
  if (windowMatches(def.peak, dayType, minute)) return "peak";
  return "shoulder";
}
