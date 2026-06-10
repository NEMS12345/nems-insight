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
import { createMeteringPointAction, importDataAction } from "../../actions";

const STATUS_STYLE: Record<string, string> = {
  parsed: "text-good",
  partial: "text-warn",
  failed: "text-bad",
  pending: "text-foreground/50",
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
        <h2 className="font-medium">Import history</h2>
        {batches.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">No imports yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded border border-border">
            {batches.map((b) => (
              <li key={b.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{b.filename}</span>
                  <span
                    className={`text-xs font-medium ${STATUS_STYLE[b.status] ?? ""}`}
                  >
                    {b.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-foreground/50">
                  {new Date(b.uploadedAt).toLocaleString("en-AU")} ·{" "}
                  {b.readingCount.toLocaleString("en-AU")} readings
                  {b.errorCount > 0 && ` · ${b.errorCount} errors`}
                  {b.warningCount > 0 && ` · ${b.warningCount} warnings`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
