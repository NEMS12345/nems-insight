import type { IntervalReading } from "@/core/types";

/**
 * The minimal shape the analytics functions need. Any source of interval data (the DB
 * repositories, or the NEM12 parser output) can be adapted to this. The core stays pure:
 * it knows nothing about where the data came from.
 */
export type AnalyticsReading = Pick<
  IntervalReading,
  "channel" | "intervalStart" | "intervalLength" | "value" | "unit" | "quality"
>;

export type ChannelKind = "consumption" | "export" | "reactive" | "other";

/**
 * Classify a NMI channel suffix by its first letter (AEMO NMI suffix convention):
 *   E = active import (consumption), B = active export (solar/generation),
 *   Q/K = reactive. Anything else is "other".
 */
export function channelKind(channel: string): ChannelKind {
  const c = channel.trim().charAt(0).toUpperCase();
  if (c === "E") return "consumption";
  if (c === "B") return "export";
  if (c === "Q" || c === "K") return "reactive";
  return "other";
}

/** Hours covered by one interval (e.g. 0.5 for a 30-minute interval). */
export function intervalHours(intervalLength: number): number {
  return intervalLength / 60;
}

/**
 * Average power over an interval, in kW (or kVAr for reactive), from interval energy.
 * energy[kWh] / time[h] = power[kW].
 */
export function intervalPowerKw(value: number, intervalLength: number): number {
  return value / intervalHours(intervalLength);
}
