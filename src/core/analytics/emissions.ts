// Scope 2 electricity emissions using Australian National Greenhouse Accounts (NGA) factors.
//
// IMPORTANT: NGA factors are published annually by DCCEEW and trend down over time, so the
// figure must be cited by year and is overridable per review. The values below are
// indicative location-based Scope 2 factors (t CO₂-e / MWh) — CONFIRM against the current
// NGA release before issuing a report.
export const NGA_FACTOR_YEAR = "2024 (indicative — confirm current NGA release)";

export const NGA_SCOPE2_LOCATION_T_PER_MWH: Record<string, number> = {
  QLD: 0.71,
  NSW: 0.66,
  VIC: 0.77,
  SA: 0.23,
  WA: 0.51,
  TAS: 0.12,
  NT: 0.54,
};

export function ngaFactor(state: string | undefined): number {
  return NGA_SCOPE2_LOCATION_T_PER_MWH[(state ?? "").toUpperCase()] ?? 0.68;
}

export interface Scope2 {
  /** Location-based Scope 2, tonnes CO₂-e. */
  locationTonnes: number;
  /** Market-based Scope 2, tonnes CO₂-e (lower if GreenPower/LGCs/PPA reduce the factor). */
  marketTonnes: number;
  factorTPerMwh: number;
  factorYear: string;
}

/**
 * Scope 2 emissions for a quantity of grid electricity.
 * @param renewableFraction share of supply covered by GreenPower/PPA/surrendered LGCs (0–1).
 */
export function scope2(
  kWh: number,
  factorTPerMwh: number,
  renewableFraction = 0,
): Scope2 {
  const location = (kWh / 1000) * factorTPerMwh;
  return {
    locationTonnes: location,
    marketTonnes: location * (1 - Math.min(1, Math.max(0, renewableFraction))),
    factorTPerMwh,
    factorYear: NGA_FACTOR_YEAR,
  };
}

/** CO₂ avoided by self-consumed/generated solar, same method/units as Scope 2. */
export function emissionsAvoided(kWh: number, factorTPerMwh: number): number {
  return (kWh / 1000) * factorTPerMwh;
}
