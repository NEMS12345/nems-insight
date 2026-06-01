import Link from "next/link";
import { notFound } from "next/navigation";
import { getSite } from "@/data/repositories/sites";
import { getClient } from "@/data/repositories/clients";
import { listMeteringPointsForSite } from "@/data/repositories/meteringPoints";
import { createMeteringPointAction } from "../../actions";

export default async function SitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const site = await getSite(siteId);
  if (!site) notFound();

  const [client, meteringPoints] = await Promise.all([
    getClient(site.clientId),
    listMeteringPointsForSite(siteId),
  ]);

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
          <p className="mt-2 text-sm text-foreground/60">No metering points yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 rounded border border-black/10">
            {meteringPoints.map((mp) => (
              <li
                key={mp.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="font-mono">{mp.nmi}</span>
                <span className="text-xs text-foreground/50">{mp.meterType}</span>
              </li>
            ))}
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
    </div>
  );
}
