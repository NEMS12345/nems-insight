import Link from "next/link";
import { listClients } from "@/data/repositories/clients";
import { createClientAction } from "./actions";

export default async function ClientsPage() {
  const clients = await listClients();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="text-xl font-semibold">Clients</h1>
        <p className="text-sm text-foreground/60">
          Your portfolio of customer businesses.
        </p>

        {clients.length === 0 ? (
          <p className="mt-4 text-sm text-foreground/60">
            No clients yet — add your first one below.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-black/10 rounded border border-black/10">
            {clients.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.03]"
                >
                  <span>{c.name}</span>
                  <span className="text-xs uppercase text-foreground/50">
                    {c.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-black/10 p-4">
        <h2 className="font-medium">New client</h2>
        <form action={createClientAction} className="mt-3 flex flex-col gap-3">
          <input
            name="name"
            required
            placeholder="Business name"
            className="rounded border border-black/15 px-3 py-2 text-sm"
          />
          <input
            name="abn"
            placeholder="ABN (optional)"
            className="rounded border border-black/15 px-3 py-2 text-sm"
          />
          <select
            name="status"
            defaultValue="prospect"
            className="rounded border border-black/15 px-3 py-2 text-sm"
          >
            <option value="prospect">Prospect</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <button
            type="submit"
            className="self-start rounded bg-foreground px-3 py-2 text-sm text-background"
          >
            Add client
          </button>
        </form>
      </section>
    </div>
  );
}
