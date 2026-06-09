// Bridge between the cost engine / operator input and the reconciliation engine. Turns a
// modelled CostResult and the operator-entered billed buckets into the canonical
// BillComponent[] that `reconcile` compares. Pure TypeScript — no DB/framework imports.
//
// Modelled side: every CostLine the engine produces carries a `component` (taxonomy kind) and,
// for energy, a `subKey` (ToU period or "all"). Lines are aggregated by component; a flat
// "all" energy charge (e.g. a non-ToU network volume rate) is distributed across the ToU
// buckets in proportion to the actual energy in each period, so both sides line up on the same
// peak/shoulder/off-peak buckets the operator enters.

import type { CostResult, TouPeriod } from "@/core/tariff/types";
import {
  type BillComponent,
  type ComponentKind,
  COMPONENT_LABEL,
  ENERGY_PERIOD_LABEL,
  natureOf,
} from "@/core/reconciliation/taxonomy";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const TOU: readonly TouPeriod[] = ["peak", "shoulder", "offpeak"];

/** Map a modelled cost breakdown to canonical components, ToU-bucketing energy. */
export function modelledComponents(cost: CostResult): BillComponent[] {
  const energy: Record<TouPeriod, number> = { peak: 0, shoulder: 0, offpeak: 0 };
  const byKind = new Map<ComponentKind, number>();
  const totalE =
    cost.energyByPeriod.peak + cost.energyByPeriod.shoulder + cost.energyByPeriod.offpeak;

  for (const line of cost.lines) {
    const kind: ComponentKind = line.component ?? "other";
    if (kind !== "energy") {
      byKind.set(kind, (byKind.get(kind) ?? 0) + line.amount);
      continue;
    }
    const sub = line.subKey;
    if (sub === "peak" || sub === "shoulder" || sub === "offpeak") {
      energy[sub] += line.amount;
    } else if (totalE > 0) {
      // Flat "all" energy: split across ToU buckets by the period's share of energy.
      for (const p of TOU) energy[p] += line.amount * (cost.energyByPeriod[p] / totalE);
    } else {
      energy.shoulder += line.amount; // no energy at all — park it in the catch-all bucket
    }
  }

  const out: BillComponent[] = [];
  for (const p of TOU) {
    if (energy[p] !== 0) {
      out.push({
        kind: "energy",
        subKey: p,
        label: ENERGY_PERIOD_LABEL[p],
        amount: round2(energy[p]),
        nature: "modelled",
      });
    }
  }
  for (const [kind, amount] of byKind) {
    out.push({ kind, label: COMPONENT_LABEL[kind], amount: round2(amount), nature: natureOf(kind) });
  }
  return out;
}

/**
 * The operator-entered billed side. Each field is one canonical bucket (ex-GST AUD). A blank
 * field (null/undefined) is treated as "not on this bill" — the matching component will then
 * read as unbilled on the modelled side rather than a zero-dollar billed line.
 */
export interface BilledBuckets {
  energyPeak?: number | null;
  energyShoulder?: number | null;
  energyOffpeak?: number | null;
  demand?: number | null;
  supply?: number | null;
  environmental?: number | null;
  market?: number | null;
  metering?: number | null;
  other?: number | null;
}

/** Map operator-entered buckets to canonical billed components (omitting blank buckets). */
export function billedComponents(b: BilledBuckets): BillComponent[] {
  const out: BillComponent[] = [];
  const push = (kind: ComponentKind, subKey: string | undefined, label: string, v: number | null | undefined) => {
    if (v == null) return;
    out.push({ kind, subKey, label, amount: round2(v), nature: natureOf(kind) });
  };
  push("energy", "peak", ENERGY_PERIOD_LABEL.peak, b.energyPeak);
  push("energy", "shoulder", ENERGY_PERIOD_LABEL.shoulder, b.energyShoulder);
  push("energy", "offpeak", ENERGY_PERIOD_LABEL.offpeak, b.energyOffpeak);
  push("demand", undefined, COMPONENT_LABEL.demand, b.demand);
  push("supply", undefined, COMPONENT_LABEL.supply, b.supply);
  push("environmental", undefined, COMPONENT_LABEL.environmental, b.environmental);
  push("market_fees", undefined, COMPONENT_LABEL.market_fees, b.market);
  push("metering", undefined, COMPONENT_LABEL.metering, b.metering);
  push("other", undefined, COMPONENT_LABEL.other, b.other);
  return out;
}

/** Sum of billed buckets — the bill's ex-GST total derived from the entered components. */
export function billedBucketsTotal(b: BilledBuckets): number {
  return round2(billedComponents(b).reduce((s, c) => s + c.amount, 0));
}
