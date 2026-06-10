// Component-wise reconciliation: compare a MODELLED cost breakdown against a DECLARED (billed)
// one, component by component, and judge whether the bill looks correct. Pure TypeScript.
//
// Design points this enforces:
//   • Dual tolerance: a component is only "investigate" when it breaches BOTH an absolute ($)
//     and a relative (%) threshold — so tiny components don't trip on rounding and large ones
//     don't hide a real dollar gap.
//   • Pass-through components (environmental certs, market fees, GST, …) are reported but
//     EXCLUDED from the billing-error bottom line and judgement — we don't model them, so a
//     variance there is not a retailer error.
//   • Estimated data lowers confidence, it doesn't manufacture errors. A heavily-estimated
//     month is reported as "low-confidence", not "investigate".

import {
  type BillComponent,
  type ComponentKind,
  type ComponentNature,
  componentKey,
} from "@/core/reconciliation/taxonomy";

export interface ReconcileOptions {
  /** Absolute $ tolerance per component; variance within this is never an error. Default $5. */
  absoluteToleranceAud?: number;
  /** Relative tolerance per component (fraction); e.g. 0.02 = 2%. Default 0.02. */
  relativeTolerance?: number;
  /** Fraction of the period's interval data that is estimated/substituted (0–1). Default 0. */
  estimatedDataPct?: number;
  /** At/above this estimated fraction the result is flagged low-confidence. Default 0.20 (20%). */
  lowConfidenceEstimatedPct?: number;
  /** Fraction (0–1) of the bill period's days that have interval data. Default 1 (full). */
  coverageFraction?: number;
  /** Below this coverage the verdict is withheld as "insufficient-data". Default 0.90 (90%). */
  minCoverageFraction?: number;
}

const DEFAULTS: Required<ReconcileOptions> = {
  absoluteToleranceAud: 5,
  relativeTolerance: 0.02,
  estimatedDataPct: 0,
  lowConfidenceEstimatedPct: 0.2,
  coverageFraction: 1,
  minCoverageFraction: 0.9,
};

export type ComponentStatus =
  | "match" // within tolerance
  | "review" // one tolerance breached — worth a look
  | "investigate" // both tolerances breached — likely billing error
  | "pass-through" // informational; excluded from billing-error judgement
  | "unbilled" // modelled but absent from the bill
  | "unmodelled"; // on the bill but not modelled (and tagged modelled, not pass-through)

export interface ComponentVariance {
  key: string;
  kind: ComponentKind;
  subKey?: string;
  label: string;
  nature: ComponentNature;
  modelledAud: number | null; // null = no modelled value for this key
  billedAud: number | null; // null = not on the bill
  varianceAud: number; // billed − modelled (absent side treated as 0)
  variancePct: number | null; // relative to modelled; null when modelled is 0/absent
  status: ComponentStatus;
}

export type Judgement =
  | "match"
  | "review"
  | "investigate"
  | "low-confidence"
  | "insufficient-data";

export interface ReconciliationResult {
  components: ComponentVariance[];
  // Bottom line over MODELLED-nature components only:
  modelledTotalAud: number;
  billedModelledTotalAud: number;
  netVarianceAud: number; // billedModelled − modelledTotal
  netVariancePct: number | null;
  // Informational, excluded from the error judgement:
  passThroughBilledAud: number;
  // Confidence:
  estimatedDataPct: number;
  /** Fraction (0–1) of the period's days with interval data behind the modelled side. */
  coverageFraction: number;
  confidence: "ok" | "low";
  judgement: Judgement;
}

const SEVERITY: Record<ComponentStatus, number> = {
  match: 0,
  "pass-through": 0,
  unbilled: 2,
  unmodelled: 2,
  review: 1,
  investigate: 2,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Reconcile modelled vs billed component breakdowns. Both arrays are fixtures (or, in Phase 4,
 * the output of the cost engine and the operator-entered bill) — this function does no I/O.
 */
export function reconcile(
  modelled: BillComponent[],
  billed: BillComponent[],
  options: ReconcileOptions = {},
): ReconciliationResult {
  const opts = { ...DEFAULTS, ...options };

  const modelledByKey = new Map(modelled.map((c) => [componentKey(c), c]));
  const billedByKey = new Map(billed.map((c) => [componentKey(c), c]));
  const allKeys = new Set([...modelledByKey.keys(), ...billedByKey.keys()]);

  const components: ComponentVariance[] = [];

  for (const key of allKeys) {
    const m = modelledByKey.get(key);
    const b = billedByKey.get(key);
    const ref = m ?? b!; // for kind/label/nature; at least one exists
    // A component is pass-through if EITHER side declares it pass-through.
    const nature: ComponentNature =
      m?.nature === "pass-through" || b?.nature === "pass-through" ? "pass-through" : "modelled";

    const modelledAud = m ? m.amount : null;
    const billedAud = b ? b.amount : null;
    const varianceAud = round2((billedAud ?? 0) - (modelledAud ?? 0));
    const pct =
      modelledAud && modelledAud !== 0 ? ((billedAud ?? 0) - modelledAud) / modelledAud : null;

    let status: ComponentStatus;
    if (nature === "pass-through") {
      status = "pass-through";
    } else if (m && !b) {
      status = "unbilled";
    } else if (b && !m) {
      status = "unmodelled";
    } else {
      const breachAbs = Math.abs(varianceAud) > opts.absoluteToleranceAud;
      const breachRel = pct !== null && Math.abs(pct) > opts.relativeTolerance;
      status = breachAbs && breachRel ? "investigate" : breachAbs || breachRel ? "review" : "match";
    }

    components.push({
      key,
      kind: ref.kind,
      subKey: ref.subKey,
      label: ref.label,
      nature,
      modelledAud,
      billedAud,
      varianceAud,
      variancePct: pct,
      status,
    });
  }

  // Stable, useful ordering: errors first, then by absolute variance.
  components.sort(
    (a, b) => SEVERITY[b.status] - SEVERITY[a.status] || Math.abs(b.varianceAud) - Math.abs(a.varianceAud),
  );

  const modelledComponents = components.filter((c) => c.nature === "modelled");
  const modelledTotalAud = round2(modelledComponents.reduce((s, c) => s + (c.modelledAud ?? 0), 0));
  const billedModelledTotalAud = round2(
    modelledComponents.reduce((s, c) => s + (c.billedAud ?? 0), 0),
  );
  const netVarianceAud = round2(billedModelledTotalAud - modelledTotalAud);
  const netVariancePct = modelledTotalAud !== 0 ? netVarianceAud / modelledTotalAud : null;

  const passThroughBilledAud = round2(
    components
      .filter((c) => c.nature === "pass-through")
      .reduce((s, c) => s + (c.billedAud ?? 0), 0),
  );

  // The modelled side prices only the days we have. If too much of the period is missing,
  // the comparison isn't valid — withhold the verdict rather than manufacture an "error".
  const insufficientData = opts.coverageFraction < opts.minCoverageFraction;

  const confidence: "ok" | "low" =
    insufficientData || opts.estimatedDataPct >= opts.lowConfidenceEstimatedPct ? "low" : "ok";

  const worst = modelledComponents.reduce(
    (acc, c) => Math.max(acc, SEVERITY[c.status]),
    0,
  );
  const baseJudgement: Judgement = worst >= 2 ? "investigate" : worst === 1 ? "review" : "match";
  // Precedence: missing days (can't compare at all) → heavily-estimated (don't trust the
  // numbers) → the component-level verdict.
  const judgement: Judgement = insufficientData
    ? "insufficient-data"
    : confidence === "low"
      ? "low-confidence"
      : baseJudgement;

  return {
    components,
    modelledTotalAud,
    billedModelledTotalAud,
    netVarianceAud,
    netVariancePct,
    passThroughBilledAud,
    estimatedDataPct: opts.estimatedDataPct,
    coverageFraction: opts.coverageFraction,
    confidence,
    judgement,
  };
}
