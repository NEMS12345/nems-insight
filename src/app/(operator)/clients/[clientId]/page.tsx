import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/data/repositories/clients";
import { listSitesForClient } from "@/data/repositories/sites";
import { clientEnergy, siteEnergiesForClient } from "@/data/repositories/rollups";
import { energyLabel } from "@/lib/format";
import { createSiteAction } from "../../actions";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();

  const [sites, energy, siteEnergies] = await Promise.all([
    listSitesForClient(clientId),
    clientEnergy(clientId),
    siteEnergiesForClient(clientId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <nav className="text-sm text-foreground/50">
        <Link href="/" className="hover:underline">
          Clients
        </Link>{" "}
        / <span className="text-foreground/70">{client.name}</span>
      </nav>

      <section>
        <h1 className="text-xl font-semibold">{client.name}</h1>
        <p className="text-sm text-foreground/60">
          {client.abn ? `ABN ${client.abn} · ` : ""}
          {client.status}
          {energy.readingCount > 0
            ? ` · ${energyLabel(energy.importKwh)} across ${sites.length} site${sites.length === 1 ? "" : "s"}`
            : ""}
        </p>
      </section>

      <section>
        <h2 className="font-medium">Sites</h2>
        {sites.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">No sites yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded border border-border">
            {sites.map((s) => {
              const e = siteEnergies.get(s.id);
              return (
                <li key={s.id}>
                  <Link
                    href={`/sites/${s.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.03]"
                  >
                    <span>{s.name}</span>
                    <span className="text-xs text-foreground/50">
                      {e && e.readingCount > 0
                        ? `${energyLabel(e.importKwh)} · `
                        : ""}
                      {[s.network, s.state].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded border border-border p-4">
        <h2 className="font-medium">New site</h2>
        <form action={createSiteAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input
            name="name"
            required
            placeholder="Site name"
            className="rounded border border-border px-3 py-2 text-sm"
          />
          <input
            name="address"
            placeholder="Address (optional)"
            className="rounded border border-border px-3 py-2 text-sm"
          />
          <div className="flex gap-3">
            <input
              name="state"
              placeholder="State (e.g. QLD)"
              className="w-32 rounded border border-border px-3 py-2 text-sm"
            />
            <input
              name="network"
              placeholder="Network/DNSP (e.g. Energex)"
              className="flex-1 rounded border border-border px-3 py-2 text-sm"
            />
          </div>
          <input
            name="floorAreaM2"
            type="number"
            step="0.1"
            placeholder="Floor area m² (optional — for energy intensity)"
            className="rounded border border-border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="self-start rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white"
          >
            Add site
          </button>
        </form>
      </section>
    </div>
  );
}
