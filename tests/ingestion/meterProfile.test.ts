import { describe, it, expect } from "vitest";
import { parseMeterProfile } from "@/ingestion/parsers/meterProfile";

function row(
  meter: string,
  period: number,
  kwh: number,
  extra: Record<string, unknown> = {},
) {
  return {
    nmi: "QB04077571",
    meter_serial: meter,
    date: new Date(Date.UTC(2025, 3, 1)), // 2025-04-01, like exceljs (UTC wall time)
    interval: 30,
    period,
    kwh,
    ...extra,
  };
}

describe("parseMeterProfile", () => {
  it("maps columns to channels and normalises to interval-start (AEST)", () => {
    const res = parseMeterProfile([
      row("211261816", 1, 29.86, { generated_kwh: 0, kvarh: 14.27 }),
    ]);
    expect(res.errors).toEqual([]);
    expect(res.readings).toHaveLength(3); // E1, B1, Q1

    const byChan = Object.fromEntries(res.readings.map((r) => [r.channel, r]));
    expect(byChan.E1.value).toBe(29.86);
    expect(byChan.E1.unit).toBe("kWh");
    expect(byChan.B1.channel).toBe("B1");
    expect(byChan.Q1.unit).toBe("kVArh");
    expect(byChan.E1.intervalStart).toBe("2025-04-01T00:00:00+10:00");
    expect(byChan.E1.meterSerial).toBe("211261816");
    expect(byChan.E1.quality).toBe("actual");
  });

  it("derives interval-start from period and interval length", () => {
    const res = parseMeterProfile([row("211261816", 3, 30.1)]);
    // period 3, 30-min -> (3-1)*30 = 60 min -> 01:00
    expect(res.readings[0].intervalStart).toBe("2025-04-01T01:00:00+10:00");
  });

  it("keeps each meter serial separate (does not sum)", () => {
    const res = parseMeterProfile([
      row("211261816", 1, 29.86),
      row("211262619", 1, 92.91),
    ]);
    const e1 = res.readings.filter((r) => r.channel === "E1");
    expect(e1).toHaveLength(2);
    expect(new Set(e1.map((r) => r.meterSerial))).toEqual(
      new Set(["211261816", "211262619"]),
    );
    expect(res.nmis).toEqual(["QB04077571"]); // same NMI, two meters
  });

  it("only emits channels whose columns are present", () => {
    const res = parseMeterProfile([row("211261816", 1, 10)]); // no generated_kwh/kvarh
    expect(res.readings.map((r) => r.channel)).toEqual(["E1"]);
  });

  it("records an error for a row missing date or period", () => {
    const res = parseMeterProfile([
      { nmi: "X", meter_serial: "1", kwh: 5, interval: 30 },
    ]);
    expect(res.readings).toHaveLength(0);
    expect(res.errors.some((e) => e.includes("missing date or period"))).toBe(true);
  });
});
