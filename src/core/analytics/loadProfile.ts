import type { AnalyticsReading } from "@/core/analytics/types";
import { channelKind, intervalPowerKw } from "@/core/analytics/types";
import { aestMinuteOfDay } from "@/core/analytics/time";

export interface LoadProfilePoint {
  /** Minutes past AEST midnight for this slot. */
  minuteOfDay: number;
  /** Average consumption power in this slot across the period, kW. */
  avgKw: number;
  /** Number of intervals averaged into this slot. */
  samples: number;
}

/**
 * Average daily load shape: mean consumption power for each time-of-day slot across the
 * whole period. This is the classic "what does a typical day look like" profile — it makes
 * peaky vs flat usage obvious at a glance.
 */
export function loadProfileByTimeOfDay(
  readings: ReadonlyArray<AnalyticsReading>,
): LoadProfilePoint[] {
  const slots = new Map<number, { powerSum: number; samples: number }>();

  for (const r of readings) {
    if (channelKind(r.channel) !== "consumption") continue;
    const minute = aestMinuteOfDay(r.intervalStart);
    const slot = slots.get(minute) ?? { powerSum: 0, samples: 0 };
    slot.powerSum += intervalPowerKw(r.value, r.intervalLength);
    slot.samples++;
    slots.set(minute, slot);
  }

  return [...slots.entries()]
    .map(([minuteOfDay, { powerSum, samples }]) => ({
      minuteOfDay,
      avgKw: powerSum / samples,
      samples,
    }))
    .sort((a, b) => a.minuteOfDay - b.minuteOfDay);
}
