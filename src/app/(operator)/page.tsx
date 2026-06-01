import Link from "next/link";
import { listClients } from "@/data/repositories/clients";
import { clientEnergies } from "@/data/repositories/rollups";
import { getLatestMarketPrice } from "@/data/repositories/marketPrices";
import { getLatestEmissionsFactor } from "@/data/repositories/emissionsFactors";
import { ngaFactor, NGA_FACTOR_YEAR } from "@/core/analytics";
import { energyLabel } from "@/lib/format";
import {
  createClientAction,
  createMarketPriceAction,
  createEmissionsFactorAction,
} from "./actions";

export default async function ClientsPage() {
  const [clients, energies, qldPrice, qldFactor] = await Promise.all([
    listClients(),
    clientEnergies(),
    getLatestMarketPrice("QLD"),
    getLatestEmissionsFactor("QLD"),
  ]);
  const emissionsFactorValue = qldFactor?.factorTPerMwh ?? ngaFactor("QLD");
  const emissionsFactorSource = qldFactor?.ngaYear ?? `${NGA_FACTOR_YEAR} (default)`;

  const portfolioKwh = [...energies.values()].reduce(
    (sum, e) => sum + e.importKwh,
    0,
  );
  const clientsWithData = [...energies.values()].filter(
    (e) => e.readingCount > 0,
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="text-xl font-semibold">Portfolio</h1>
        <p className="text-sm text-foreground/60">
          {clients.length} client{clients.length === 1 ? "" : "s"} ·{" "}
          {clientsWithData} with data · {energyLabel(portfolioKwh)} total consumption
        </p>
      </section>

      <section className="rounded border border-black/10 bg-black/[0.02] p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Market reference price (ASX QLD futures)</h2>
          <span className="text-sm text-foreground/60">
            {qldPrice
              ? `$${qldPrice.futuresPerMwh.toFixed(2)}/MWh · captured ${qldPrice.capturedOn}`
              : "not set — retail benchmark on hold"}
          </span>
        </div>
        <form action={createMarketPriceAction} className="mt-3 flex items-end gap-3">
          <input type="hidden" name="region" value="QLD" />
          <label className="flex flex-col gap-1 text-xs text-foreground/60">
            Today&apos;s QLD base-load futures ($/MWh)
            <input
              name="futuresPerMwh"
              type="number"
              step="0.01"
              required
              placeholder="e.g. 120.00"
              className="rounded border border-black/15 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-foreground px-3 py-2 text-sm text-background"
          >
            Save today&apos;s rate
          </button>
        </form>
      </section>

      <section className="rounded border border-black/10 bg-black/[0.02] p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Emissions factor (NGA, QLD)</h2>
          <span className="text-sm text-foreground/60">
            {emissionsFactorValue} t CO₂-e/MWh · {emissionsFactorSource}
          </span>
        </div>
        <form action={createEmissionsFactorAction} className="mt-3 flex items-end gap-3">
          <input type="hidden" name="region" value="QLD" />
          <label className="flex flex-col gap-1 text-xs text-foreground/60">
            NGA Scope 2 factor (t CO₂-e/MWh)
            <input
              name="factorTPerMwh"
              type="number"
              step="0.00001"
              required
              placeholder="e.g. 0.71"
              className="rounded border border-black/15 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-foreground/60">
            NGA year/source
            <input
              name="ngaYear"
              placeholder="e.g. NGA 2024"
              className="rounded border border-black/15 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-foreground px-3 py-2 text-sm text-background"
          >
            Save factor
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-medium">Clients</h2>
        {clients.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">
            No clients yet — add your first one below.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 rounded border border-black/10">
            {clients.map((c) => {
              const e = energies.get(c.id);
              return (
                <li key={c.id}>
                  <Link
                    href={`/clients/${c.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.03]"
                  >
                    <span>{c.name}</span>
                    <span className="text-xs text-foreground/50">
                      {e && e.readingCount > 0
                        ? `${energyLabel(e.importKwh)} →`
                        : c.status}
                    </span>
                  </Link>
                </li>
              );
            })}
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
