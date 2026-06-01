import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind, intervalPowerKw } from "@/core/analytics/types";

export interface PowerFactorResult {
  /** Power factor in (0, 1], or null when it can't be determined (no reactive data). */
  powerFactor: number | null;
  realKwh: number;
  reactiveKvarh: number;
  /** Whether the dataset actually contains a reactive (Q) channel. */
  reactiveDataAvailable: boolean;
}

function pf(realKwh: number, reactiveKvarh: number): number | null {
  const apparent = Math.sqrt(realKwh * realKwh + reactiveKvarh * reactiveKvarh);
  if (apparent === 0) return null;
  return realKwh / apparent;
}

/** Does this dataset include a reactive (Q) channel? PF/kVA can only be derived if so. */
export function hasReactiveData(
  readings: ReadonlyArray<AnalyticsReading>,
): boolean {
  return readings.some((r) => channelKind(r.channel) === "reactive");
}

/**
 * Average power factor over a period. CRUCIAL: if the dataset has NO reactive channel, power
 * factor is NOT determinable — we return null (never a fabricated 1.00). Only when reactive
 * data is present is a real PF computed.
 */
export function periodPowerFactor(
  readings: ReadonlyArray<AnalyticsReading>,
): PowerFactorResult {
  let realKwh = 0;
  let reactiveKvarh = 0;
  let reactiveSeen = false;

  for (const r of readings) {
    const kind = channelKind(r.channel);
    if (kind === "consumption") realKwh += r.value;
    else if (kind === "reactive") {
      reactiveKvarh += r.value;
      reactiveSeen = true;
    }
  }

  return {
    powerFactor: reactiveSeen ? pf(realKwh, reactiveKvarh) : null,
    realKwh,
    reactiveKvarh,
    reactiveDataAvailable: reactiveSeen,
  };
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

export interface PeakDemandPowerFactor {
  intervalStart: string | null;
  kw: number;
  /** Apparent power at the peak; null when not determinable (no reactive data). */
  kva: number | null;
  powerFactor: number | null;
  reactiveDataAvailable: boolean;
}

/**
 * Power factor and kVA at the demand-setting interval. Without reactive data, kVA and PF are
 * NOT determinable (we never assume unity) — they return null and reactiveDataAvailable=false,
 * and the caller must either suppress kVA-based analysis or use an explicit assumed PF.
 * The peak is chosen on kW when reactive is absent (so we still report when demand peaks).
 */
export function powerFactorAtPeakDemand(
  readings: ReadonlyArray<AnalyticsReading>,
): PeakDemandPowerFactor {
  const reactiveAvailable = hasReactiveData(readings);
  const byInterval = new Map<string, { real: number; reactive: number; length: number }>();
  for (const r of readings) {
    const kind = channelKind(r.channel);
    if (kind !== "consumption" && kind !== "reactive") continue;
    const slot = byInterval.get(r.intervalStart) ?? { real: 0, reactive: 0, length: r.intervalLength };
    if (kind === "consumption") slot.real += r.value;
    else slot.reactive += r.value;
    byInterval.set(r.intervalStart, slot);
  }

  let bestKw = 0;
  let best: PeakDemandPowerFactor = {
    intervalStart: null, kw: 0, kva: null, powerFactor: null, reactiveDataAvailable: reactiveAvailable,
  };
  for (const [intervalStart, { real, reactive, length }] of byInterval) {
    const kw = intervalPowerKw(real, length);
    // Pick the demand-setting interval by kVA when reactive exists, else by kW.
    const rank = reactiveAvailable
      ? Math.sqrt(kw * kw + intervalPowerKw(reactive, length) ** 2)
      : kw;
    if (rank > bestKw) {
      bestKw = rank;
      const kvar = intervalPowerKw(reactive, length);
      const kva = reactiveAvailable ? Math.sqrt(kw * kw + kvar * kvar) : null;
      best = {
        intervalStart,
        kw,
        kva,
        powerFactor: reactiveAvailable && kva && kva > 0 ? kw / kva : null,
        reactiveDataAvailable: reactiveAvailable,
      };
    }
  }
  return best;
}
