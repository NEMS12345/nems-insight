// Shared domain vocabulary for NEMS Insight (Layer 2 — pure core).
//
// These types are the single definition of the entities every layer talks about. They
// are DRAFT and will firm up during Phase 1 (schema) and Phase 4 (tariff/cost). They
// contain no logic and no framework/DB imports — keep it that way (see CLAUDE.md §3).

/** A NEM12 channel/stream suffix, e.g. "E1" (consumption), "B1" (export), "Q1" (reactive). */
export type Channel = string;

/** Unit of a reading. kWh for energy channels, kVArh for reactive channels. */
export type ReadingUnit = "kWh" | "kVArh";

/**
 * Data quality of an interval, mirroring AEMO NEM12 quality codes.
 * Never treat estimated/substituted data as actual — reports must surface it.
 */
export type QualityFlag =
  | "actual" // A
  | "substituted" // S
  | "final-substituted" // F
  | "estimated" // E
  | "null"; // N — no data

/** Interval length in minutes. NEM moved to 5-minute settlement; older data is often 30. */
export type IntervalLength = 5 | 15 | 30;

/** The operator organisation running the managed service. */
export interface Organisation {
  id: string;
  name: string;
}

/** A customer business — the portfolio that owns sites. Tenancy boundary for RLS. */
export interface Client {
  id: string;
  orgId: string;
  name: string;
  abn?: string;
  status: "active" | "prospect" | "archived";
}

/** A physical premises belonging to a client. */
export interface Site {
  id: string;
  clientId: string;
  name: string;
  address?: string;
  state?: string; // AU state/territory, e.g. "QLD"
  network?: string; // DNSP, e.g. "Energex"
}

/**
 * A metering point. v1 = an NMI / parent meter. `meterType` is kept general so other
 * meter types can be added later without changing the abstraction.
 */
export interface MeteringPoint {
  id: string;
  siteId: string;
  nmi: string;
  meterType: "nmi-parent";
}

/**
 * A single interval of metered data. Keyed conceptually by
 * (meteringPointId, channel, intervalStart) — a metering point reports MULTIPLE channels
 * per interval, not one number.
 */
export interface IntervalReading {
  meteringPointId: string;
  channel: Channel;
  intervalStart: string; // ISO 8601 timestamp (stored as timestamptz)
  intervalLength: IntervalLength;
  value: number;
  unit: ReadingUnit;
  quality: QualityFlag;
}
