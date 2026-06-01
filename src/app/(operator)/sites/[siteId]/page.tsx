import Link from "next/link";
import { notFound } from "next/navigation";
import { getSite } from "@/data/repositories/sites";
import { getClient } from "@/data/repositories/clients";
import { listMeteringPointsForSite } from "@/data/repositories/meteringPoints";
import {
  listImportBatchesForClient,
  readingCountByMeteringPoint,
} from "@/data/repositories/imports";
import { createMeteringPointAction, importNem12Action } from "../../actions";

const STATUS_STYLE: Record<string, string> = {
  parsed: "text-green-700",
  partial: "text-amber-700",
  failed: "text-red-700",
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

  const [client, meteringPoints, batches] = await Promise.all([
    getClient(site.clientId),
    listMeteringPointsForSite(siteId),
    listImportBatchesForClient(site.clientId),
  ]);
  const counts = await readingCountByMeteringPoint(meteringPoints.map((m) => m.id));

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
        </p>
      </section>

      <section>
        <h2 className="font-medium">Metering points (NMIs)</h2>
        {meteringPoints.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">
            No metering points yet — add one before importing data.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 rounded border border-black/10">
            {meteringPoints.map((mp) => {
              const n = counts.get(mp.id) ?? 0;
              return (
                <li key={mp.id}>
                  <Link
                    href={`/metering-points/${mp.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.03]"
                  >
                    <span className="font-mono">{mp.nmi}</span>
                    <span className="text-xs text-foreground/50">
                      {n > 0
                        ? `${n.toLocaleString("en-AU")} intervals →`
                        : "no data yet"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded border border-black/10 p-4">
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
            className="rounded border border-black/15 px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            className="self-start rounded bg-foreground px-3 py-2 text-sm text-background"
          >
            Add NMI
          </button>
        </form>
      </section>

      <section className="rounded border border-black/10 p-4">
        <h2 className="font-medium">Import NEM12 data</h2>
        <p className="mt-1 text-xs text-foreground/60">
          Upload a NEM12 file. Its NMIs are matched to the metering points above; all
          channels (consumption, export, reactive) are imported with quality flags.
        </p>
        <form
          action={importNem12Action}
          className="mt-3 flex flex-col gap-3"
        >
          <input type="hidden" name="siteId" value={siteId} />
          <input
            type="file"
            name="file"
            required
            accept=".csv,.dat,.txt,text/csv,text/plain"
            className="text-sm"
          />
          <button
            type="submit"
            className="self-start rounded bg-foreground px-3 py-2 text-sm text-background"
          >
            Upload &amp; import
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-medium">Import history</h2>
        {batches.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">No imports yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 rounded border border-black/10">
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
