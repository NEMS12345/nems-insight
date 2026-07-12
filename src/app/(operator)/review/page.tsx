import Link from "next/link";
import { listAllLatestRuns } from "@/data/repositories/reconciliations";
import { SubmitButton } from "@/components/SubmitButton";
import { moneyLabel } from "@/lib/format";
import {
  triageFindingAction,
  signOffRunAction,
  reopenRunAction,
} from "../actions";

/**
 * [v1.1] Review & sign-off — triage each finding (confirmed error / queried / dismissed /
 * within tolerance), add the operator note + client-facing recommendation, then sign off
 * the month. The client report renders only signed-off content; confirming an error
 * automatically opens its recovery.
 */

const JUDGEMENT_STYLE: Record<string, string> = {
  match: "bg-good/10 text-good",
  review: "bg-warn/10 text-warn",
  investigate: "bg-bad/10 text-bad",
  "low-confidence": "bg-warn/10 text-warn",
  "insufficient-data": "bg-warn/10 text-warn",
};

const REASON_LABEL: Record<string, string> = {
  overcharge: "Overcharge",
  undercharge: "Undercharge",
  not_billed: "Modelled, not billed",
  not_modelled: "Billed, not modelled",
  within_tolerance: "Within tolerance",
  pass_through: "Pass-through",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  confirmed_error: "Confirmed error",
  queried: "Queried",
  dismissed: "Dismissed",
  within_tolerance: "Within tolerance",
};

export default async function ReviewPage() {
  const runs = await listAllLatestRuns();
  const open = runs.filter((r) => !r.signedAt);
  const signed = runs.filter((r) => r.signedAt);

  return (
    <div className="flex flex-col gap-8">
      <nav className="text-sm text-foreground/50">
        <Link href="/" className="hover:underline">
          Clients
        </Link>{" "}
        / <span className="text-foreground/70">Review &amp; sign-off</span>
      </nav>

      <section>
        <h1 className="text-xl font-semibold">Review &amp; sign-off</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Each bill&apos;s latest reconciliation run, awaiting triage. Resolve every open
          finding (confirm the error, query it, dismiss it, or accept the variance), then sign
          off — the client report shows only signed-off content, and confirmed errors go
          straight to the recovery pipeline. Runs come from &ldquo;Save for review&rdquo; on a
          bill&apos;s metering-point page.
        </p>
      </section>

      {runs.length === 0 && (
        <p className="text-sm text-foreground/60">
          Nothing to review yet — open a metering point and use &ldquo;Save for review&rdquo;
          on a bill.
        </p>
      )}

      {open.map((run) => {
        const openFindings = run.findings.filter((f) => f.status === "open");
        const triaged = run.findings.filter((f) => f.status !== "open");
        return (
          <section key={run.id} className="rounded border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="font-medium">{run.clientName}</span>{" "}
                <Link
                  href={`/metering-points/${run.meteringPointId}`}
                  className="font-mono text-sm hover:underline"
                >
                  {run.nmi}
                </Link>{" "}
                <span className="text-sm text-foreground/50">
                  · {run.periodStart} → {run.periodEnd}
                  {run.retailer ? ` · ${run.retailer}` : ""}
                </span>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${JUDGEMENT_STYLE[run.judgement] ?? ""}`}
              >
                {run.judgement}
              </span>
            </div>
            <div className="mt-1 text-xs text-foreground/60">
              Billed {moneyLabel(run.billedTotal)} · Modelled {moneyLabel(run.modelledTotal)} ·
              run {new Date(run.computedAt).toLocaleString("en-AU")}
              {run.coverageFraction != null &&
                ` · ${(run.coverageFraction * 100).toFixed(0)}% of period covered by data`}
            </div>

            {openFindings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-3">
                {openFindings.map((f) => (
                  <li key={f.id} className="rounded border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{f.label}</span>
                      <span className="text-xs text-foreground/60">
                        {REASON_LABEL[f.reasonCode]} ·{" "}
                        {f.modelled != null ? `modelled ${moneyLabel(f.modelled)}` : "not modelled"}{" "}
                        / {f.billed != null ? `billed ${moneyLabel(f.billed)}` : "not billed"} ·
                        variance {moneyLabel(f.variance)}
                        {f.variancePct != null && ` (${(f.variancePct * 100).toFixed(1)}%)`}
                      </span>
                    </div>
                    <form
                      action={triageFindingAction}
                      className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2"
                    >
                      <input type="hidden" name="findingId" value={f.id} />
                      <input type="hidden" name="clientId" value={run.clientId} />
                      <input type="hidden" name="variance" value={f.variance} />
                      <select
                        name="status"
                        defaultValue={
                          f.reasonCode === "overcharge" ? "confirmed_error" : "queried"
                        }
                        className="rounded border border-border px-2 py-1.5 text-sm md:col-span-2"
                      >
                        <option value="confirmed_error">
                          Confirmed error — open a recovery
                        </option>
                        <option value="queried">Queried — awaiting information</option>
                        <option value="dismissed">Dismissed — not an error</option>
                        <option value="within_tolerance">Accept variance (within tolerance)</option>
                      </select>
                      <input
                        name="operatorNote"
                        placeholder="Operator note (what you checked, internal)"
                        className="rounded border border-border px-2 py-1.5 text-sm"
                      />
                      <input
                        name="recommendation"
                        placeholder="Client-facing recommendation (appears on the report)"
                        className="rounded border border-border px-2 py-1.5 text-sm"
                      />
                      <SubmitButton
                        className="justify-self-start rounded bg-accent hover:bg-accent-hover px-3 py-1.5 text-sm text-white"
                        pendingText="Saving…"
                      >
                        Save triage
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {triaged.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-xs text-foreground/60">
                {triaged.map((f) => (
                  <li key={f.id}>
                    <span className="font-medium text-foreground/80">{f.label}</span> —{" "}
                    {STATUS_LABEL[f.status]} · variance {moneyLabel(f.variance)}
                    {f.operatorNote && ` · ${f.operatorNote}`}
                  </li>
                ))}
              </ul>
            )}

            <form action={signOffRunAction} className="mt-3">
              <input type="hidden" name="runId" value={run.id} />
              <SubmitButton
                className={`rounded px-3 py-1.5 text-sm text-white ${
                  openFindings.length > 0
                    ? "cursor-not-allowed bg-foreground/30"
                    : "bg-accent hover:bg-accent-hover"
                }`}
                pendingText="Signing off…"
              >
                {openFindings.length > 0
                  ? `Sign off (resolve ${openFindings.length} open finding${openFindings.length === 1 ? "" : "s"} first)`
                  : "Sign off — release to client report"}
              </SubmitButton>
            </form>
          </section>
        );
      })}

      {signed.length > 0 && (
        <section>
          <h2 className="font-medium">Signed off</h2>
          <ul className="mt-2 divide-y divide-border rounded border border-border">
            {signed.map((run) => (
              <li
                key={run.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-medium">{run.clientName}</span>{" "}
                  <span className="font-mono">{run.nmi}</span>{" "}
                  <span className="text-foreground/50">
                    · {run.periodStart} → {run.periodEnd} · signed{" "}
                    {run.signedAt && new Date(run.signedAt).toLocaleDateString("en-AU")}
                  </span>
                </span>
                <form action={reopenRunAction}>
                  <input type="hidden" name="runId" value={run.id} />
                  <SubmitButton
                    className="rounded border border-border px-2 py-1 text-xs text-foreground/60 hover:text-foreground"
                    pendingText="Re-opening…"
                  >
                    Re-open
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
