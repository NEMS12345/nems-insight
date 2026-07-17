import Link from "next/link";
import { listClients } from "@/data/repositories/clients";
import { clientEnergies } from "@/data/repositories/rollups";
import { getLatestMarketPrice } from "@/data/repositories/marketPrices";
import { getLatestEmissionsFactor } from "@/data/repositories/emissionsFactors";
import { workQueue } from "@/data/repositories/workQueue";
import { ngaFactor, NGA_FACTOR_YEAR } from "@/core/analytics";
import { energyLabel, moneyLabel } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import {
  createClientAction,
  createMarketPriceAction,
  createEmissionsFactorAction,
} from "./actions";

/** Days without new data before a client is flagged stale on the work queue. */
const STALE_DAYS = 40;

export default async function ClientsPage() {
  const [clients, energies, qldPrice, qldFactor, queue] = await Promise.all([
    listClients(),
    clientEnergies(),
    getLatestMarketPrice("QLD"),
    getLatestEmissionsFactor("QLD"),
    workQueue(),
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

  const staleCutoff = Date.now() - STALE_DAYS * 24 * 3600 * 1000;
  const outstanding = [...queue.byClient.values()].reduce(
    (s, c) => s + c.pendingBatches + c.unsignedBills + c.unassignedNmis + c.openRecoveries,
    0,
  );

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="text-xl font-semibold">Portfolio — this month&apos;s work</h1>
        <p className="text-sm text-foreground/60">
          {clients.length} client{clients.length === 1 ? "" : "s"} ·{" "}
          {clientsWithData} with data · {energyLabel(portfolioKwh)} total consumption
          {outstanding > 0
            ? ` · ${outstanding} item${outstanding === 1 ? "" : "s"} outstanding`
            : " · all clear"}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:w-2/3">
          <div className="rounded border border-border p-4">
            <div className="text-xs uppercase tracking-wide text-foreground/50">
              Billing errors identified
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {moneyLabel(queue.totals.identified)}
            </div>
          </div>
          <div className="rounded border border-good/40 bg-good/5 p-4">
            <div className="text-xs uppercase tracking-wide text-foreground/50">
              Recovered for clients
            </div>
            <div className="mt-1 text-2xl font-semibold text-good">
              {moneyLabel(queue.totals.recovered)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-border bg-black/[0.02] p-4">
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
              className="rounded border border-border px-3 py-2 text-sm"
            />
          </label>
          <SubmitButton
            className="rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white"
            pendingText="Saving…"
          >
            Save today&apos;s rate
          </SubmitButton>
        </form>
      </section>

      <section className="rounded border border-border bg-black/[0.02] p-4">
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
              className="rounded border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-foreground/60">
            NGA year/source
            <input
              name="ngaYear"
              placeholder="e.g. NGA 2024"
              className="rounded border border-border px-3 py-2 text-sm"
            />
          </label>
          <SubmitButton
            className="rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white"
            pendingText="Saving…"
          >
            Save factor
          </SubmitButton>
        </form>
      </section>

      <section>
        <h2 className="font-medium">Clients</h2>
        {clients.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">
            No clients yet — add your first one below.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded border border-border">
            {clients.map((c) => {
              const e = energies.get(c.id);
              const cq = queue.byClient.get(c.id);
              const stale =
                cq?.lastUploadAt != null && Date.parse(cq.lastUploadAt) < staleCutoff;
              const chips: Array<{ text: string; cls: string }> = [];
              if (cq?.unassignedNmis)
                chips.push({
                  text: `${cq.unassignedNmis} NMI${cq.unassignedNmis === 1 ? "" : "s"} unassigned`,
                  cls: "bg-bad/10 text-bad",
                });
              if (cq?.pendingBatches)
                chips.push({
                  text: `${cq.pendingBatches} import${cq.pendingBatches === 1 ? "" : "s"} to review`,
                  cls: "bg-warn/10 text-warn",
                });
              if (cq?.unsignedBills)
                chips.push({
                  text: `${cq.unsignedBills} bill${cq.unsignedBills === 1 ? "" : "s"} to reconcile`,
                  cls: "bg-warn/10 text-warn",
                });
              if (cq?.openRecoveries)
                chips.push({
                  text: `${cq.openRecoveries} recover${cq.openRecoveries === 1 ? "y" : "ies"} open`,
                  cls: "bg-accent/10 text-accent",
                });
              if (stale) chips.push({ text: "data stale", cls: "bg-bad/10 text-bad" });
              return (
                <li key={c.id}>
                  <Link
                    href={`/clients/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-black/[0.03]"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      {c.name}
                      {chips.map((chip) => (
                        <span
                          key={chip.text}
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${chip.cls}`}
                        >
                          {chip.text}
                        </span>
                      ))}
                      {chips.length === 0 && (
                        <span className="rounded bg-good/10 px-1.5 py-0.5 text-[11px] font-medium text-good">
                          up to date
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-foreground/50">
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

      <section className="rounded border border-border p-4">
        <h2 className="font-medium">New client</h2>
        <form action={createClientAction} className="mt-3 flex flex-col gap-3">
          <input
            name="name"
            required
            placeholder="Business name"
            className="rounded border border-border px-3 py-2 text-sm"
          />
          <input
            name="abn"
            placeholder="ABN (optional)"
            className="rounded border border-border px-3 py-2 text-sm"
          />
          <select
            name="status"
            defaultValue="prospect"
            className="rounded border border-border px-3 py-2 text-sm"
          >
            <option value="prospect">Prospect</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <SubmitButton
            className="self-start rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white"
            pendingText="Adding…"
          >
            Add client
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
