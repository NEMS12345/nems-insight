import Link from "next/link";
import { notFound } from "next/navigation";
import { getSite } from "@/data/repositories/sites";
import { getClient } from "@/data/repositories/clients";
import { listMeteringPointsForSite } from "@/data/repositories/meteringPoints";
import { listImportBatchesForClient } from "@/data/repositories/imports";
import {
  siteEnergiesForClient,
  meteringPointEnergiesForSite,
} from "@/data/repositories/rollups";
import { energyLabel } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import {
  createMeteringPointAction,
  importDataAction,
  reviewImportBatchAction,
} from "../../actions";

const STATUS_STYLE: Record<string, string> = {
  parsed: "text-good",
  partial: "text-warn",
  failed: "text-bad",
  pending: "text-foreground/50",
};

const REVIEW_STYLE: Record<string, string> = {
  accepted: "bg-good/10 text-good",
  pending_review: "bg-warn/10 text-warn",
  needs_redata: "bg-bad/10 text-bad",
};
const REVIEW_LABEL: Record<string, string> = {
  accepted: "Accepted",
  pending_review: "Pending review",
  needs_redata: "Needs re-data",
};

export default async function SitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const site = await getSite(siteId);
  if (!site) notFound();

  const [client, meteringPoints, batches, siteEnergies, mpEnergies] =
    await Promise.all([
      getClient(site.clientId),
      listMeteringPointsForSite(siteId),
      listImportBatchesForClient(site.clientId),
      siteEnergiesForClient(site.clientId),
      meteringPointEnergiesForSite(siteId),
    ]);
  const siteTotal = siteEnergies.get(siteId);

  return (
    <div className="flex flex-col gap-8">
      <nav className="text-sm text-foreground/50">
        <Link href="/" className="hover:underline">
          Clients
        </Link>{" "}
        /{" "}
        <Link href={`/clients/${site.clientId}`} className="hover:underline">
          {client?.name ?? "Client"}
        </Link>{" "}
        / <span className="text-foreground/70">{site.name}</span>
      </nav>

      <section>
        <h1 className="text-xl font-semibold">{site.name}</h1>
        <p className="text-sm text-foreground/60">
          {[site.address, site.network, site.state].filter(Boolean).join(" · ")}
          {siteTotal && siteTotal.readingCount > 0
            ? ` · ${energyLabel(siteTotal.importKwh)} total`
            : ""}
        </p>
      </section>

      <section>
        <h2 className="font-medium">Metering points (NMIs)</h2>
        {meteringPoints.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">
            No metering points yet — add one before importing data.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded border border-border">
            {meteringPoints.map((mp) => {
              const e = mpEnergies.get(mp.id);
              return (
                <li key={mp.id}>
                  <Link
                    href={`/metering-points/${mp.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.03]"
                  >
                    <span className="font-mono">
                      {mp.nmi}
                      {mp.meterSerial && (
                        <span className="ml-2 text-xs text-foreground/40">
                          meter {mp.meterSerial}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-foreground/50">
                      {e && e.readingCount > 0
                        ? `${energyLabel(e.importKwh)} →`
                        : "no data yet"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded border border-border p-4">
        <h2 className="font-medium">New metering point</h2>
        <form
          action={createMeteringPointAction}
          className="mt-3 flex flex-col gap-3"
        >
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="clientId" value={site.clientId} />
          <input
            name="nmi"
            required
            placeholder="NMI (e.g. 31000000000)"
            className="rounded border border-border px-3 py-2 font-mono text-sm"
          />
          <input
            name="meterSerial"
            placeholder="Meter serial (optional — only if the NMI has several meters)"
            className="rounded border border-border px-3 py-2 font-mono text-sm"
          />
          <select
            name="tariffCode"
            defaultValue="7200"
            className="rounded border border-border px-3 py-2 text-sm"
          >
            <option value="7200">Network tariff: Energex 7200 (SAC Large TOU)</option>
            <option value="7400">Network tariff: Energex 7400 (11kV TOU Demand)</option>
          </select>
          <div className="flex gap-3">
            <input
              name="mlf"
              type="number"
              step="0.00001"
              placeholder="MLF (e.g. 1.01060)"
              className="w-1/2 rounded border border-border px-3 py-2 text-sm"
            />
            <input
              name="dlf"
              type="number"
              step="0.00001"
              placeholder="DLF (e.g. 1.04388)"
              className="w-1/2 rounded border border-border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-3">
            <select
              name="connectionVoltage"
              defaultValue=""
              className="w-1/2 rounded border border-border px-3 py-2 text-sm"
            >
              <option value="">Connection voltage… (for tariff eligibility)</option>
              <option value="LV">LV (low voltage)</option>
              <option value="HV">HV (high voltage / 11kV)</option>
            </select>
            <input
              name="assumedPf"
              type="number"
              step="0.01"
              min="0"
              max="1"
              placeholder="Assumed PF (only if no reactive data)"
              className="w-1/2 rounded border border-border px-3 py-2 text-sm"
            />
          </div>
          <input
            name="connectionUnits"
            type="number"
            step="0.001"
            min="0"
            placeholder="Connection units (11kV/7400 only — the count from the bill's connection unit charge)"
            className="rounded border border-border px-3 py-2 text-sm"
          />
          <SubmitButton
            className="self-start rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white"
            pendingText="Adding…"
          >
            Add NMI
          </SubmitButton>
        </form>
      </section>

      <section className="rounded border border-border p-4">
        <h2 className="font-medium">Import interval data</h2>
        <p className="mt-1 text-xs text-foreground/60">
          Upload a NEM12 file (.csv/.dat) or a 30-minute meter-profile export (.xlsx). NMIs
          and meter serials are matched to the metering points above; all channels
          (consumption, export, reactive) are imported with quality flags.
        </p>
        <form
          action={importDataAction}
          className="mt-3 flex flex-col gap-3"
        >
          <input type="hidden" name="siteId" value={siteId} />
          <input
            type="file"
            name="file"
            required
            accept=".csv,.dat,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-sm"
          />
          <SubmitButton
            className="self-start rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white"
            pendingText="Importing… (large files can take a minute)"
          >
            Upload &amp; import
          </SubmitButton>
        </form>
      </section>

      <section>
        <h2 className="font-medium">Import history &amp; quality gate</h2>
        <p className="mt-1 text-xs text-foreground/60">
          A batch feeds cost modelling and reconciliation only once <strong>accepted</strong>.
          Review its data quality (share of actual vs estimated reads, gaps), then accept it or
          mark it needs re-data — quarantined batches feed nothing.
        </p>
        {batches.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">No imports yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded border border-border">
            {batches.map((b) => (
              <li key={b.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{b.filename}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${REVIEW_STYLE[b.reviewState] ?? ""}`}
                    >
                      {REVIEW_LABEL[b.reviewState] ?? b.reviewState}
                    </span>
                    <span
                      className={`text-xs font-medium ${STATUS_STYLE[b.status] ?? ""}`}
                    >
                      {b.status}
                    </span>
                  </span>
                </div>
                <div className="mt-1 text-xs text-foreground/50">
                  {new Date(b.uploadedAt).toLocaleString("en-AU")} ·{" "}
                  {b.readingCount.toLocaleString("en-AU")} readings
                  {b.errorCount > 0 && ` · ${b.errorCount} errors`}
                  {b.warningCount > 0 && ` · ${b.warningCount} warnings`}
                </div>
                {b.qualitySummary && (
                  <div className="mt-1 text-xs text-foreground/60">
                    Quality: {((1 - b.qualitySummary.nonActualFraction) * 100).toFixed(1)}%
                    actual
                    {b.qualitySummary.substituted + b.qualitySummary.finalSubstituted > 0 &&
                      ` · ${b.qualitySummary.substituted + b.qualitySummary.finalSubstituted} substituted`}
                    {b.qualitySummary.estimated > 0 &&
                      ` · ${b.qualitySummary.estimated} estimated`}
                    {b.qualitySummary.gapCount > 0 &&
                      ` · ${b.qualitySummary.gapCount} gaps (${b.qualitySummary.missingIntervals} intervals missing)`}
                    {b.qualitySummary.gapCount === 0 && " · no gaps"}
                  </div>
                )}
                {b.reviewState !== "accepted" && (
                  <div className="mt-2 flex gap-2">
                    <form action={reviewImportBatchAction}>
                      <input type="hidden" name="batchId" value={b.id} />
                      <input type="hidden" name="siteId" value={siteId} />
                      <input type="hidden" name="state" value="accepted" />
                      <SubmitButton
                        className="rounded bg-accent hover:bg-accent-hover px-2.5 py-1 text-xs text-white"
                        pendingText="Accepting…"
                      >
                        Accept — feed the model
                      </SubmitButton>
                    </form>
                    {b.reviewState !== "needs_redata" && (
                      <form action={reviewImportBatchAction}>
                        <input type="hidden" name="batchId" value={b.id} />
                        <input type="hidden" name="siteId" value={siteId} />
                        <input type="hidden" name="state" value="needs_redata" />
                        <SubmitButton
                          className="rounded border border-border px-2.5 py-1 text-xs text-foreground/70 hover:border-bad/50 hover:text-bad"
                          pendingText="Marking…"
                        >
                          Needs re-data
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
