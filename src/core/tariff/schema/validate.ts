// Validator for the general network-tariff schema. Catches structural mistakes in tariff
// DATA before it ever reaches a cost engine: bad time windows, dangling season references,
// malformed demand ratchets, badly-ordered block steps, and an inconsistent placeholder
// flag. Pure TypeScript — no DB/framework imports.

import type {
  NetworkTariffSchema,
  Charge,
  EnergyRate,
  TimeWindow,
  Season,
} from "@/core/tariff/schema";

export interface ValidationIssue {
  path: string; // where the problem is, e.g. "charges[2].measurement.windows[0]"
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}

const MINUTES_IN_DAY = 1440;

function validateWindow(w: TimeWindow, path: string, errors: ValidationIssue[]): void {
  if (!Number.isInteger(w.startMin) || !Number.isInteger(w.endMin)) {
    errors.push({ path, message: "window start/end must be integer minutes" });
  }
  if (w.startMin < 0 || w.endMin > MINUTES_IN_DAY) {
    errors.push({ path, message: `window must be within [0, ${MINUTES_IN_DAY}]` });
  }
  if (w.startMin >= w.endMin) {
    errors.push({ path, message: "window startMin must be < endMin (half-open range)" });
  }
}

function validateSeasons(seasons: Season[], errors: ValidationIssue[]): Set<string> {
  const ids = new Set<string>();
  seasons.forEach((s, i) => {
    if (ids.has(s.id)) errors.push({ path: `seasons[${i}]`, message: `duplicate season id "${s.id}"` });
    ids.add(s.id);
    if (s.monthRanges.length === 0) {
      errors.push({ path: `seasons[${i}]`, message: "season has no month ranges" });
    }
    s.monthRanges.forEach((r, j) => {
      const bad = [r.fromMonth, r.toMonth].some((m) => !Number.isInteger(m) || m < 1 || m > 12);
      if (bad) errors.push({ path: `seasons[${i}].monthRanges[${j}]`, message: "months must be 1–12" });
    });
  });
  return ids;
}

function rateIsPlaceholder(r: { placeholder?: boolean }): boolean {
  return r.placeholder === true;
}

function validateEnergyRate(
  rate: EnergyRate,
  path: string,
  seasonIds: Set<string>,
  hasBlockReset: boolean,
  errors: ValidationIssue[],
): boolean {
  let sawPlaceholder = false;
  if (rate.dayTypes.length === 0) {
    errors.push({ path: `${path}.dayTypes`, message: "at least one day-type required" });
  }
  if (rate.seasonId && !seasonIds.has(rate.seasonId)) {
    errors.push({ path: `${path}.seasonId`, message: `unknown season "${rate.seasonId}"` });
  }
  (rate.windows ?? []).forEach((w, i) => validateWindow(w, `${path}.windows[${i}]`, errors));

  if (rate.blocks && rate.blocks.length > 0) {
    if (!hasBlockReset) {
      errors.push({ path, message: "stepped/block rate requires blockReset on the charge" });
    }
    let prevBound = 0;
    rate.blocks.forEach((b, i) => {
      const isLast = i === rate.blocks!.length - 1;
      if (b.uptoKwh === null) {
        if (!isLast) errors.push({ path: `${path}.blocks[${i}]`, message: "only the final block may be unbounded" });
      } else {
        if (b.uptoKwh <= prevBound) {
          errors.push({ path: `${path}.blocks[${i}]`, message: "block bounds must strictly increase" });
        }
        prevBound = b.uptoKwh;
      }
      if (rateIsPlaceholder(b.rate)) sawPlaceholder = true;
    });
  } else if (rateIsPlaceholder(rate.rate)) {
    sawPlaceholder = true;
  }
  return sawPlaceholder;
}

function validateCharge(
  charge: Charge,
  path: string,
  seasonIds: Set<string>,
  errors: ValidationIssue[],
): boolean {
  switch (charge.kind) {
    case "standing":
      return rateIsPlaceholder(charge.ratePerDay);
    case "monthly_fixed":
      return rateIsPlaceholder(charge.ratePerMonth);
    case "energy": {
      let saw = false;
      if (charge.rates.length === 0) errors.push({ path: `${path}.rates`, message: "energy charge has no rates" });
      const hasBlockReset = charge.blockReset !== undefined;
      charge.rates.forEach((r, i) => {
        if (validateEnergyRate(r, `${path}.rates[${i}]`, seasonIds, hasBlockReset, errors)) saw = true;
      });
      return saw;
    }
    case "demand": {
      const saw = rateIsPlaceholder(charge.rate);
      if (charge.measurement.dayTypes.length === 0) {
        errors.push({ path: `${path}.measurement.dayTypes`, message: "at least one day-type required" });
      }
      if (charge.measurement.seasonId && !seasonIds.has(charge.measurement.seasonId)) {
        errors.push({ path: `${path}.measurement.seasonId`, message: `unknown season "${charge.measurement.seasonId}"` });
      }
      (charge.measurement.windows ?? []).forEach((w, i) =>
        validateWindow(w, `${path}.measurement.windows[${i}]`, errors),
      );
      if (charge.ratchet) {
        const { percentOfPeak, lookbackMonths, appliesInSeasonId } = charge.ratchet;
        if (percentOfPeak < 0 || percentOfPeak > 100) {
          errors.push({ path: `${path}.ratchet.percentOfPeak`, message: "must be 0–100" });
        }
        if (!Number.isInteger(lookbackMonths) || lookbackMonths <= 0) {
          errors.push({ path: `${path}.ratchet.lookbackMonths`, message: "must be a positive integer" });
        }
        if (appliesInSeasonId && !seasonIds.has(appliesInSeasonId)) {
          errors.push({ path: `${path}.ratchet.appliesInSeasonId`, message: `unknown season "${appliesInSeasonId}"` });
        }
      }
      return saw;
    }
  }
}

/** Validate a tariff schema. Returns all structural errors found (does not throw). */
export function validateTariff(tariff: NetworkTariffSchema): ValidationResult {
  const errors: ValidationIssue[] = [];

  if (tariff.schemaVersion !== 1) {
    errors.push({ path: "schemaVersion", message: "unsupported schema version" });
  }
  if (!tariff.code) errors.push({ path: "code", message: "code is required" });
  if (tariff.charges.length === 0) errors.push({ path: "charges", message: "tariff has no charges" });
  if (tariff.eligibility) {
    const { minAnnualMwh, maxAnnualMwh } = tariff.eligibility;
    if (minAnnualMwh !== undefined && maxAnnualMwh !== undefined && minAnnualMwh > maxAnnualMwh) {
      errors.push({ path: "eligibility", message: "minAnnualMwh must be ≤ maxAnnualMwh" });
    }
  }

  const seasonIds = validateSeasons(tariff.seasons, errors);

  let anyPlaceholder = false;
  tariff.charges.forEach((c, i) => {
    if (validateCharge(c, `charges[${i}]`, seasonIds, errors)) anyPlaceholder = true;
  });

  if (anyPlaceholder !== tariff.containsPlaceholders) {
    errors.push({
      path: "containsPlaceholders",
      message: `flag is ${tariff.containsPlaceholders} but ${anyPlaceholder ? "placeholders are present" : "no placeholders found"}`,
    });
  }

  return { ok: errors.length === 0, errors };
}
