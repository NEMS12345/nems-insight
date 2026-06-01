import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/data/repositories/clients";
import { listSitesForClient } from "@/data/repositories/sites";
import { createSiteAction } from "../../actions";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();

  const sites = await listSitesForClient(clientId);

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
        </p>
      </section>

      <section>
        <h2 className="font-medium">Sites</h2>
        {sites.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">No sites yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 rounded border border-black/10">
            {sites.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sites/${s.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.03]"
                >
                  <span>{s.name}</span>
                  <span className="text-xs text-foreground/50">
                    {[s.network, s.state].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-black/10 p-4">
        <h2 className="font-medium">New site</h2>
        <form action={createSiteAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input
            name="name"
            required
            placeholder="Site name"
            className="rounded border border-black/15 px-3 py-2 text-sm"
          />
          <input
            name="address"
            placeholder="Address (optional)"
            className="rounded border border-black/15 px-3 py-2 text-sm"
          />
          <div className="flex gap-3">
            <input
              name="state"
              placeholder="State (e.g. QLD)"
              className="w-32 rounded border border-black/15 px-3 py-2 text-sm"
            />
            <input
              name="network"
              placeholder="Network/DNSP (e.g. Energex)"
              className="flex-1 rounded border border-black/15 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="self-start rounded bg-foreground px-3 py-2 text-sm text-background"
          >
            Add site
          </button>
        </form>
      </section>
    </div>
  );
}
