import Link from "next/link";
import {
  listRecoveriesDetailed,
  recoveryTotals,
} from "@/data/repositories/recoveries";
import { SubmitButton } from "@/components/SubmitButton";
import { moneyLabel } from "@/lib/format";
import { updateRecoveryAction } from "../actions";

/**
 * [v1.1] Recover & track — the chase on every confirmed billing error:
 * to_raise → query_lodged → responded → recovered, with amounts, dates and the retailer
 * reference. The "$ recovered" metric is the managed service's proof of value.
 */

const STATE_LABEL: Record<string, string> = {
  to_raise: "To raise",
  query_lodged: "Query lodged",
  responded: "Retailer responded",
  recovered: "Recovered",
};
const STATE_STYLE: Record<string, string> = {
  to_raise: "bg-bad/10 text-bad",
  query_lodged: "bg-warn/10 text-warn",
  responded: "bg-warn/10 text-warn",
  recovered: "bg-good/10 text-good",
};
const NEXT_STATES: Record<string, string[]> = {
  to_raise: ["query_lodged"],
  query_lodged: ["responded", "recovered"],
  responded: ["recovered", "query_lodged"],
  recovered: ["responded"], // re-openable, like everything in the loop
};

export default async function RecoveryPage() {
  const [recoveries, totals] = await Promise.all([
    listRecoveriesDetailed(),
    recoveryTotals(),
  ]);
  const open = recoveries.filter((r) => r.state !== "recovered");
  const done = recoveries.filter((r) => r.state === "recovered");

  return (
    <div className="flex flex-col gap-8">
      <nav className="text-sm text-foreground/50">
        <Link href="/" className="hover:underline">
          Clients
        </Link>{" "}
        / <span className="text-foreground/70">Recovery</span>
      </nav>

      <section>
        <h1 className="text-xl font-semibold">Recover &amp; track</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Confirmed billing errors, chased to recovered dollars. Advancing a step stamps its
          date; add the retailer reference when the query is lodged and the credited amount
          when it lands.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:w-2/3">
          <div className="rounded border border-border p-4">
            <div className="text-xs uppercase tracking-wide text-foreground/50">
              Identified
            </div>
            <div className="mt-1 text-2xl font-semibold">{moneyLabel(totals.identified)}</div>
          </div>
          <div className="rounded border border-good/40 bg-good/5 p-4">
            <div className="text-xs uppercase tracking-wide text-foreground/50">
              Recovered
            </div>
            <div className="mt-1 text-2xl font-semibold text-good">
              {moneyLabel(totals.recovered)}
            </div>
          </div>
        </div>
      </section>

      {recoveries.length === 0 && (
        <p className="text-sm text-foreground/60">
          No recoveries yet — confirming an error in{" "}
          <Link href="/review" className="underline">
            Review
          </Link>{" "}
          opens one automatically.
        </p>
      )}

      {[
        { title: "In progress", items: open },
        { title: "Recovered", items: done },
      ].map(
        ({ title, items }) =>
          items.length > 0 && (
            <section key={title}>
              <h2 className="font-medium">{title}</h2>
              <ul className="mt-2 flex flex-col gap-3">
                {items.map((r) => (
                  <li key={r.id} className="rounded border border-border p-4 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{r.clientName}</span>{" "}
                        <span className="font-mono text-xs">{r.nmi}</span>{" "}
                        <span className="text-foreground/50">
                          · {r.findingLabel}
                          {r.periodStart && ` · ${r.periodStart} → ${r.periodEnd}`}
                        </span>
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLE[r.state]}`}
                      >
                        {STATE_LABEL[r.state]}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-foreground/60">
                      Identified {moneyLabel(r.amountIdentified)}
                      {r.amountRecovered != null &&
                        ` · recovered ${moneyLabel(r.amountRecovered)}`}
                      {r.retailerRef && ` · ref ${r.retailerRef}`}
                      {r.raisedAt && ` · raised ${r.raisedAt}`}
                      {r.lodgedAt && ` · lodged ${r.lodgedAt}`}
                      {r.respondedAt && ` · responded ${r.respondedAt}`}
                      {r.recoveredAt && ` · recovered ${r.recoveredAt}`}
                      {r.notes && ` · ${r.notes}`}
                    </div>
                    {r.state !== "recovered" && (
                      <form
                        action={updateRecoveryAction}
                        className="mt-2 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="recoveryId" value={r.id} />
                        <label className="flex flex-col gap-1 text-xs text-foreground/60">
                          Advance to
                          <select
                            name="state"
                            className="rounded border border-border px-2 py-1.5 text-sm"
                          >
                            {(NEXT_STATES[r.state] ?? []).map((s) => (
                              <option key={s} value={s}>
                                {STATE_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-foreground/60">
                          Retailer ref
                          <input
                            name="retailerRef"
                            defaultValue={r.retailerRef ?? ""}
                            placeholder="e.g. case number"
                            className="rounded border border-border px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-foreground/60">
                          $ recovered (when credited)
                          <input
                            name="amountRecovered"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="—"
                            className="w-36 rounded border border-border px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-foreground/60">
                          Note
                          <input
                            name="notes"
                            defaultValue={r.notes ?? ""}
                            className="rounded border border-border px-2 py-1.5 text-sm"
                          />
                        </label>
                        <SubmitButton
                          className="rounded bg-accent hover:bg-accent-hover px-3 py-1.5 text-sm text-white"
                          pendingText="Updating…"
                        >
                          Update
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </div>
  );
}
