import type { Tariff, PeriodDefinition } from "@/core/tariff/types";
import { pickEffective } from "@/core/tariff/effective";

// These are NETWORK-only tariffs. Retail pricing is per-NMI (see retail.ts / RetailPlan)
// because retail contracts differ per metering point.

// Time-of-use windows for Energex 7200 (Large TOU). Source: Energex Network Tariff Guide
// §3.3. Peak 5–8pm weekdays, off-peak 11am–1pm daily, shoulder otherwise.
const ENERGEX_7200_PERIODS: PeriodDefinition = {
  peak: { dayTypes: ["weekday"], ranges: [{ startMin: 17 * 60, endMin: 20 * 60 }] },
  offpeak: {
    dayTypes: ["weekday", "weekend"],
    ranges: [{ startMin: 11 * 60, endMin: 13 * 60 }],
  },
};

/**
 * Energex 7200 — Large TOU Demand & Energy (SAC Large, >100 MWh/yr). Published NUOS rates
 * (2026-27). Demand uses the kW variant (kVA variant applies once reactive data is present).
 */
export const ENERGEX_7200: Tariff = {
  code: "7200",
  name: "Energex 7200 (SAC Large TOU)",
  network: "Energex",
  currency: "AUD",
  voltageClass: "LV",
  eligibility: { minAnnualMwh: 100 },
  hasEstimatedCharges: false,
  effectiveFrom: "2026-07-01", // Energex NUOS 2026-27
  periods: ENERGEX_7200_PERIODS,
  charges: [
    { kind: "fixed_daily", category: "network", label: "Network fixed charge", ratePerDay: 9.257 },
    { kind: "energy", category: "network", label: "Network energy (peak)", period: "peak", rate: 0.01876 },
    { kind: "energy", category: "network", label: "Network energy (shoulder)", period: "shoulder", rate: 0.02947 },
    { kind: "energy", category: "network", label: "Network energy (off-peak)", period: "offpeak", rate: 0.01627 },
    { kind: "demand_monthly", category: "network", label: "Network demand (peak)", period: "peak", unit: "kW", rate: 15.459 },
    { kind: "demand_monthly", category: "network", label: "Network demand (shoulder)", period: "shoulder", unit: "kW", rate: 4.08 },
  ],
};

// Energex 7400 — 11kV TOU Demand (CAC HV). Network energy is a flat volume charge; demand is
// a single kVA peak charge measured 9am–9pm weekdays (Tariff Guide). Rates from the bill.
const ENERGEX_7400_PERIODS: PeriodDefinition = {
  peak: { dayTypes: ["weekday"], ranges: [{ startMin: 9 * 60, endMin: 21 * 60 }] },
  offpeak: { dayTypes: [], ranges: [] },
};

export const ENERGEX_7400: Tariff = {
  code: "7400",
  name: "Energex 7400 (11kV TOU Demand)",
  network: "Energex",
  currency: "AUD",
  voltageClass: "HV",
  hasEstimatedCharges: false,
  // Rates derived from a real Origin invoice for the Mar-2026 bill period — i.e. the 2025-26
  // Energex financial-year rate set (network rates change each 1 July).
  effectiveFrom: "2025-07-01",
  periods: ENERGEX_7400_PERIODS,
  charges: [
    { kind: "fixed_daily", category: "network", label: "Network access (DUOS)", ratePerDay: 22.306 },
    { kind: "fixed_daily", category: "network", label: "Jurisdictional scheme (fixed)", ratePerDay: 0.573 },
    { kind: "connection_unit", category: "network", label: "DUOS connection unit charge", ratePerUnit: 245.582 },
    { kind: "energy", category: "network", label: "Network volume (DUOS+TUOS+JS)", period: "all", rate: 0.01974 },
    { kind: "demand_monthly", category: "network", label: "Network peak demand (DUOS+TUOS)", period: "peak", unit: "kVA", rate: 11.011 },
  ],
};

/**
 * Effective-dated registry of network tariffs. Energex network rates change on 1 July, so each
 * code maps to its rate-set VERSIONS over time. A bill is costed on the version that applied
 * during its period (see `getTariff(code, asOf)`), so older bills stay correct after a rate
 * update and new bills get the new rates — no fork. When the next 1 July rates land, prepend a
 * new dated `Tariff` value here: a DATA edit, never an engine change. Keep versions newest-first.
 */
export const TARIFF_VERSIONS: Record<string, Tariff[]> = {
  "7200": [ENERGEX_7200],
  "7400": [ENERGEX_7400],
};

/** Current (latest) version of each tariff — convenience for live analytics and pickers. */
export const TARIFFS: Record<string, Tariff> = Object.fromEntries(
  Object.entries(TARIFF_VERSIONS).map(([code, versions]) => [code, latestVersion(versions)]),
);

function latestVersion(versions: Tariff[]): Tariff {
  return [...versions].sort((a, b) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""))[0];
}

/**
 * The tariff for `code`, as it applied on `asOf` ("YYYY-MM-DD"). Picks the newest version whose
 * `effectiveFrom` is on or before `asOf`. Without `asOf`, returns the current (latest) version.
 * If `asOf` predates every version we hold, falls back to the OLDEST version (we cost on the
 * earliest rates we have rather than nothing — documented behaviour until an older version is
 * added). Returns undefined for an unknown code.
 */
export function getTariff(code: string, asOf?: string): Tariff | undefined {
  const versions = TARIFF_VERSIONS[code];
  if (!versions || versions.length === 0) return undefined;
  return pickEffective(versions, asOf);
}
