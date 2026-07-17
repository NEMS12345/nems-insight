// Public-holiday calendars as DATA, per state. Most DNSPs treat public holidays as
// off-peak (or as weekend day-types) regardless of which weekday they fall on, so the
// time-of-use classifier needs to know them. Calendars are local dates ("YYYY-MM-DD").
//
// v1 ships a QLD stub (the only DNSP populated for v1 is Energex/SE QLD). Other states are
// placeholders to be filled from the relevant state's gazetted public-holiday list. We never
// fabricate dates: a year not listed in `completeYears` means classification falls back to
// weekday/weekend for that year and the report should note holidays were not applied.
//
// Pure TypeScript — no DB/framework imports.

import type { AustralianState } from "@/core/tariff/schema";

export interface PublicHolidayCalendar {
  state: AustralianState;
  source: string;
  /** Years for which `dates` is known-complete. Outside these, classification is best-effort. */
  completeYears: number[];
  /** Gazetted public-holiday local dates, "YYYY-MM-DD". */
  dates: string[];
}

/**
 * QLD public holidays — STUB populated for 2024 and 2025 from the Queensland Government
 * gazetted list (https://www.qld.gov.au/recreation/travel/holidays/public). Show-day and
 * regional holidays are NOT included (they vary by district); add per-site if needed.
 */
export const QLD_HOLIDAYS: PublicHolidayCalendar = {
  state: "QLD",
  source: "QLD Government gazetted public holidays (statewide only)",
  completeYears: [2024, 2025],
  dates: [
    // 2024
    "2024-01-01", // New Year's Day
    "2024-01-26", // Australia Day
    "2024-03-29", // Good Friday
    "2024-03-30", // Easter Saturday
    "2024-03-31", // Easter Sunday
    "2024-04-01", // Easter Monday
    "2024-04-25", // Anzac Day
    "2024-05-06", // Labour Day
    "2024-10-07", // King's Birthday
    "2024-12-25", // Christmas Day
    "2024-12-26", // Boxing Day
    // 2025
    "2025-01-01", // New Year's Day
    "2025-01-27", // Australia Day (observed; 26th is a Sunday)
    "2025-04-18", // Good Friday
    "2025-04-19", // Easter Saturday
    "2025-04-20", // Easter Sunday
    "2025-04-21", // Easter Monday
    "2025-04-25", // Anzac Day
    "2025-05-05", // Labour Day
    "2025-10-06", // King's Birthday
    "2025-12-25", // Christmas Day
    "2025-12-26", // Boxing Day
  ],
};

/**
 * Registry of public-holiday calendars by state. Only QLD is populated for v1. Other states
 * are explicit placeholders — adding one is a data edit, not code.
 */
export const HOLIDAY_CALENDARS: Partial<Record<AustralianState, PublicHolidayCalendar>> = {
  QLD: QLD_HOLIDAYS,
  // TODO(NSW): populate from NSW gazetted public holidays before enabling Ausgrid pricing.
  // TODO(SA): populate from SA gazetted public holidays before enabling SA Power Networks pricing.
};

/**
 * Is `localDate` ("YYYY-MM-DD") a public holiday in `state`? Returns false when no calendar
 * exists or the year is outside the calendar's known-complete range — callers can detect the
 * latter via `holidayYearKnown` to flag best-effort classification.
 */
export function isPublicHoliday(state: AustralianState, localDate: string): boolean {
  const cal = HOLIDAY_CALENDARS[state];
  if (!cal) return false;
  return cal.dates.includes(localDate);
}

/** True when `state` has a calendar that is known-complete for `year`. */
export function holidayYearKnown(state: AustralianState, year: number): boolean {
  const cal = HOLIDAY_CALENDARS[state];
  return !!cal && cal.completeYears.includes(year);
}
