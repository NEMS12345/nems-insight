/**
 * Effective-dated version selection — ONE semantics for every dated rate-set (network
 * tariff versions, retail contract versions, assignments): the newest version whose
 * `effectiveFrom` is on or before `asOf`; without `asOf`, the current (latest) version;
 * if `asOf` predates every version, the OLDEST held (we price on the earliest rates we
 * have rather than nothing). A version with no `effectiveFrom` sorts as the earliest
 * (the baseline).
 */
export interface EffectiveDated {
  effectiveFrom?: string; // "YYYY-MM-DD"
}

export function pickEffective<T extends EffectiveDated>(
  versions: ReadonlyArray<T>,
  asOf?: string,
): T | undefined {
  if (versions.length === 0) return undefined;
  const newestFirst = [...versions].sort((a, b) =>
    (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""),
  );
  if (!asOf) return newestFirst[0];
  return (
    newestFirst.find((v) => !v.effectiveFrom || v.effectiveFrom <= asOf) ??
    newestFirst[newestFirst.length - 1]
  );
}

/** Effective-date changes inside an inclusive billing period. */
export function effectiveBoundariesWithin<T extends EffectiveDated>(
  versions: ReadonlyArray<T>,
  periodStart: string,
  periodEnd: string,
): string[] {
  return [...new Set(
    versions
      .map((v) => v.effectiveFrom)
      .filter((date): date is string => !!date && date > periodStart && date <= periodEnd),
  )].sort();
}

/** Billing-safe selection that never backfills a period with a future rate set. */
export function pickEffectiveStrict<T extends EffectiveDated>(
  versions: ReadonlyArray<T>,
  asOf: string,
): T | undefined {
  return [...versions]
    .filter((v) => !v.effectiveFrom || v.effectiveFrom <= asOf)
    .sort((a, b) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""))[0];
}
