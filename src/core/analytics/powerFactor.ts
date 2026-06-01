import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind } from "@/core/analytics/types";

export interface PowerFactorResult {
  /** Power factor in (0, 1], or null when there's no real energy to assess. */
  powerFactor: number | null;
  realKwh: number;
  reactiveKvarh: number;
}

function pf(realKwh: number, reactiveKvarh: number): number | null {
  const apparent = Math.sqrt(realKwh * realKwh + reactiveKvarh * reactiveKvarh);
  if (apparent === 0) return null;
  return realKwh / apparent;
}

/**
 * Average power factor over a period: total real energy / total apparent energy, where
 * apparent is derived from real (consumption) and reactive (Q) channels. Reactive data is
 * required — a site with no Q channel returns reactive 0 and a power factor of 1.
 */
export function periodPowerFactor(
  readings: ReadonlyArray<AnalyticsReading>,
): PowerFactorResult {
  let realKwh = 0;
  let reactiveKvarh = 0;

  for (const r of readings) {
    const kind = channelKind(r.channel);
    if (kind === "consumption") realKwh += r.value;
    else if (kind === "reactive") reactiveKvarh += r.value;
  }

  return { powerFactor: pf(realKwh, reactiveKvarh), realKwh, reactiveKvarh };
}

export interface IntervalPowerFactor {
  intervalStart: string;
  powerFactor: number;
}

/**
 * Power factor per interval, aligning real and reactive energy by interval start. Useful
 * for finding when power factor is worst. Intervals with no real energy are omitted.
 */
export function powerFactorByInterval(
  readings: ReadonlyArray<AnalyticsReading>,
): IntervalPowerFactor[] {
  const byInterval = new Map<string, { real: number; reactive: number }>();

  for (const r of readings) {
    const kind = channelKind(r.channel);
    if (kind !== "consumption" && kind !== "reactive") continue;
    const slot = byInterval.get(r.intervalStart) ?? { real: 0, reactive: 0 };
    if (kind === "consumption") slot.real += r.value;
    else slot.reactive += r.value;
    byInterval.set(r.intervalStart, slot);
  }

  const out: IntervalPowerFactor[] = [];
  for (const [intervalStart, { real, reactive }] of byInterval) {
    const value = pf(real, reactive);
    if (value !== null) out.push({ intervalStart, powerFactor: value });
  }
  return out.sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));
}
