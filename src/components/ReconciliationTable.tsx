import type {
  ReconciliationResult,
  ComponentStatus,
  Judgement,
} from "@/core/reconciliation";
import { moneyLabel } from "@/lib/format";

const STATUS_STYLE: Record<ComponentStatus, string> = {
  match: "text-good",
  review: "text-warn",
  investigate: "text-bad font-semibold",
  "pass-through": "text-foreground/40",
  unbilled: "text-warn",
  unmodelled: "text-warn",
};

const STATUS_LABEL: Record<ComponentStatus, string> = {
  match: "match",
  review: "review",
  investigate: "investigate",
  "pass-through": "pass-through",
  unbilled: "not billed",
  unmodelled: "not modelled",
};

const JUDGEMENT: Record<Judgement, { label: string; cls: string }> = {
  match: { label: "Matches the model", cls: "border-good/40 bg-good/5 text-good" },
  review: { label: "Worth a review", cls: "border-warn/40 bg-warn/5 text-warn" },
  investigate: {
    label: "Investigate — likely billing error",
    cls: "border-bad/40 bg-bad/5 text-bad",
  },
  "low-confidence": {
    label: "Low confidence — data heavily estimated",
    cls: "border-warn/40 bg-warn/5 text-warn",
  },
};

function pctLabel(p: number | null): string {
  return p == null ? "—" : `${(p * 100).toFixed(1)}%`;
}

/**
 * The headline view: modelled vs billed, component by component. Pass-through lines are shown
 * but greyed and excluded from the bottom-line error judgement; the net variance is over
 * modelled-nature components only.
 */
export function ReconciliationTable({ result }: { result: ReconciliationResult }) {
  const j = JUDGEMENT[result.judgement];
  return (
    <div className="flex flex-col gap-3">
      <div className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${j.cls}`}>
        <span className="font-semibold">{j.label}</span>
        <span className="tabular-nums">
          net {moneyLabel(result.netVarianceAud)}
          {result.netVariancePct != null ? ` (${pctLabel(result.netVariancePct)})` : ""}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase text-foreground/40">
          <tr>
            <th className="py-1">Component</th>
            <th className="py-1 text-right">Modelled</th>
            <th className="py-1 text-right">Billed</th>
            <th className="py-1 text-right">Variance</th>
            <th className="py-1 text-right">%</th>
            <th className="py-1 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {result.components.map((c) => (
            <tr key={c.key} className={c.nature === "pass-through" ? "text-foreground/50" : ""}>
              <td className="py-1.5">
                {c.label}
                {c.nature === "pass-through" && (
                  <span className="ml-1 text-[10px] uppercase text-foreground/30">pass-through</span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {c.modelledAud == null ? "—" : moneyLabel(c.modelledAud)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {c.billedAud == null ? "—" : moneyLabel(c.billedAud)}
              </td>
              <td className="py-1.5 text-right tabular-nums">{moneyLabel(c.varianceAud)}</td>
              <td className="py-1.5 text-right tabular-nums">{pctLabel(c.variancePct)}</td>
              <td className={`py-1.5 text-right ${STATUS_STYLE[c.status]}`}>
                {STATUS_LABEL[c.status]}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border font-medium">
          <tr>
            <td className="py-2">Modelled components</td>
            <td className="py-2 text-right tabular-nums">{moneyLabel(result.modelledTotalAud)}</td>
            <td className="py-2 text-right tabular-nums">{moneyLabel(result.billedModelledTotalAud)}</td>
            <td className="py-2 text-right tabular-nums">{moneyLabel(result.netVarianceAud)}</td>
            <td className="py-2 text-right tabular-nums">{pctLabel(result.netVariancePct)}</td>
            <td className="py-2" />
          </tr>
        </tfoot>
      </table>

      {result.passThroughBilledAud !== 0 && (
        <p className="text-[11px] text-foreground/50">
          Pass-through charges billed {moneyLabel(result.passThroughBilledAud)} (environmental,
          market/AEMO, GST) are shown for completeness but excluded from the billing-error
          judgement — they aren&apos;t independently modelled.
        </p>
      )}
    </div>
  );
}
