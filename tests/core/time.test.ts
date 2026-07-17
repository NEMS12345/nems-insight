import { describe, it, expect } from "vitest";
import {
  NEM_TIME_OFFSET_MINUTES,
  NEM_TIME_BASIS,
  nem12IntervalToInstant,
  instantToLocalParts,
  type SourceBasis,
} from "@/core/time";

// src/core/time is the ONLY place timezone conversion happens. These tests prove:
//   1. NEM12 wall-clock + interval index → absolute instant, in the documented basis.
//   2. An absolute instant → site-local wall-clock parts for ToU bucketing, and that the
//      bucketing stays correct across daylight-saving transitions in DST states and in a
//      no-DST state (Australia/Brisbane).

describe("nem12IntervalToInstant (NEM time / fixed-offset basis)", () => {
  it("defaults to NEM time = AEST (UTC+10, no DST)", () => {
    expect(NEM_TIME_OFFSET_MINUTES).toBe(600);
    expect(NEM_TIME_BASIS.kind).toBe("fixed-offset");
  });

  it("maps interval 0 of a day to 00:00 NEM time (= 14:00 UTC the previous day)", () => {
    // 2024-07-01 00:00 +10:00 == 2024-06-30 14:00Z
    const instant = nem12IntervalToInstant("20240701", 0, 30);
    expect(instant.toISOString()).toBe("2024-06-30T14:00:00.000Z");
  });

  it("maps interval 24 (30-min) to 12:00 NEM time", () => {
    // 2024-07-01 12:00 +10:00 == 2024-07-01 02:00Z
    const instant = nem12IntervalToInstant("20240701", 24, 30);
    expect(instant.toISOString()).toBe("2024-07-01T02:00:00.000Z");
  });

  it("handles 5-minute intervals", () => {
    // interval 1 of a 5-min day = 00:05 +10:00 == prev day 14:05Z
    const instant = nem12IntervalToInstant("20240701", 1, 5);
    expect(instant.toISOString()).toBe("2024-06-30T14:05:00.000Z");
  });
});

describe("instantToLocalParts — Australia/Brisbane (no daylight saving)", () => {
  it("renders a NEM-time instant unchanged (Brisbane == AEST all year)", () => {
    const instant = nem12IntervalToInstant("20240701", 24, 30); // 12:00 NEM time
    const p = instantToLocalParts(instant, "Australia/Brisbane");
    expect(p.year).toBe(2024);
    expect(p.month).toBe(7);
    expect(p.day).toBe(1);
    expect(p.hour).toBe(12);
    expect(p.minute).toBe(0);
    expect(p.minuteOfDay).toBe(12 * 60);
  });

  it("buckets summer and winter middays identically (no DST shift)", () => {
    const summerMidday = instantToLocalParts(
      nem12IntervalToInstant("20240101", 24, 30),
      "Australia/Brisbane",
    );
    const winterMidday = instantToLocalParts(
      nem12IntervalToInstant("20240701", 24, 30),
      "Australia/Brisbane",
    );
    expect(summerMidday.minuteOfDay).toBe(winterMidday.minuteOfDay);
    expect(summerMidday.minuteOfDay).toBe(12 * 60);
  });
});

describe("instantToLocalParts — Australia/Sydney across DST transitions", () => {
  // The same NEM-time instant lands at DIFFERENT local clock times in Sydney depending on
  // whether daylight saving is in force. ToU windows are defined in local clock time, so
  // this shift is exactly what we must get right.

  it("shifts NEM-time midday to 13:00 local in summer (AEDT, UTC+11)", () => {
    // Jan = AEDT. 12:00 NEM time (=02:00Z) → 13:00 Sydney.
    const p = instantToLocalParts(nem12IntervalToInstant("20240115", 24, 30), "Australia/Sydney");
    expect(p.hour).toBe(13);
    expect(p.minute).toBe(0);
    expect(p.minuteOfDay).toBe(13 * 60);
  });

  it("keeps NEM-time midday at 12:00 local in winter (AEST, UTC+10)", () => {
    const p = instantToLocalParts(nem12IntervalToInstant("20240715", 24, 30), "Australia/Sydney");
    expect(p.hour).toBe(12);
    expect(p.minuteOfDay).toBe(12 * 60);
  });

  it("spring-forward day (2024-10-06): 02:00 local does not exist — clock jumps to 03:00", () => {
    // DST starts 1st Sunday of Oct in NSW: 2024-10-06. We feed a Sydney-LOCAL wall time of
    // 02:30 and expect it to resolve to the real instant (03:30 AEDT), proving the IANA basis
    // skips the non-existent hour rather than inventing it.
    const basis: SourceBasis = { kind: "iana", timezone: "Australia/Sydney" };
    const instant = nem12IntervalToInstant("20241006", 5, 30, basis); // index 5 = 02:30 wall
    const p = instantToLocalParts(instant, "Australia/Sydney");
    // The non-existent 02:30 rolls forward into the +11:00 AEDT hour.
    expect(p.hour).toBe(3);
    expect(p.minute).toBe(30);
  });

  it("fall-back day (2025-04-06): the 02:00–03:00 hour occurs twice", () => {
    // DST ends 1st Sunday of Apr in NSW: 2025-04-06. Two distinct absolute instants both
    // read as 02:30 local — once at +11:00 (AEDT) and once at +10:00 (AEST).
    const aedt = new Date(Date.UTC(2025, 3, 5, 15, 30)); // 2025-04-06 02:30 +11:00
    const aest = new Date(Date.UTC(2025, 3, 5, 16, 30)); // 2025-04-06 02:30 +10:00
    const a = instantToLocalParts(aedt, "Australia/Sydney");
    const b = instantToLocalParts(aest, "Australia/Sydney");
    expect(a.hour).toBe(2);
    expect(a.minute).toBe(30);
    expect(b.hour).toBe(2);
    expect(b.minute).toBe(30);
    // They are genuinely different instants an hour apart.
    expect(aest.getTime() - aedt.getTime()).toBe(60 * 60 * 1000);
  });

  it("a peak-window (16:00–20:00 local) reading stays in the window across DST", () => {
    // 17:00 NEM time in summer = 18:00 Sydney (AEDT) → inside a 16:00–20:00 peak window.
    const summer = instantToLocalParts(nem12IntervalToInstant("20240115", 34, 30), "Australia/Sydney");
    expect(summer.hour).toBe(18);
    expect(summer.minuteOfDay).toBeGreaterThanOrEqual(16 * 60);
    expect(summer.minuteOfDay).toBeLessThan(20 * 60);
    // Same NEM clock time in winter = 17:00 Sydney (AEST) → still inside the window.
    const winter = instantToLocalParts(nem12IntervalToInstant("20240715", 34, 30), "Australia/Sydney");
    expect(winter.hour).toBe(17);
    expect(winter.minuteOfDay).toBeGreaterThanOrEqual(16 * 60);
    expect(winter.minuteOfDay).toBeLessThan(20 * 60);
  });
});

describe("weekday / weekend classification (local)", () => {
  it("flags Saturday/Sunday as weekend in local time", () => {
    // 2024-07-06 is a Saturday; 2024-07-08 a Monday (NEM time, Brisbane).
    const sat = instantToLocalParts(nem12IntervalToInstant("20240706", 24, 30), "Australia/Brisbane");
    const mon = instantToLocalParts(nem12IntervalToInstant("20240708", 24, 30), "Australia/Brisbane");
    expect(sat.isWeekend).toBe(true);
    expect(mon.isWeekend).toBe(false);
    expect(sat.weekday).toBe(6);
    expect(mon.weekday).toBe(1);
  });
});
