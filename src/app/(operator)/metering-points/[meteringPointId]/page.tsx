import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getMeteringPointDetail,
  getReadingsForMeteringPoint,
} from "@/data/repositories/readings";
import { getSite } from "@/data/repositories/sites";
import { getClient } from "@/data/repositories/clients";
import {
  consumptionSummary,
  dailyConsumption,
  peakDemand,
  averageDemandKw,
  periodPowerFactor,
  loadProfileByTimeOfDay,
  formatMinuteOfDay,
  aestDate,
} from "@/core/analytics";
import {
  computeFullCost,
  reconcile,
  getTariff,
  DEFAULT_RETAIL_PLAN,
  ENERGEX_7200,
} from "@/core/tariff";
import {
  modelledComponents,
  reconcile as reconcileComponents,
} from "@/core/reconciliation";
import { listBillsForMeteringPoint } from "@/data/repositories/bills";
import { getRetailPlan } from "@/data/repositories/retailPlans";
import { BarChart } from "@/components/BarChart";
import { ReconciliationTable } from "@/components/ReconciliationTable";
import { SubmitButton } from "@/components/SubmitButton";
import { moneyLabel } from "@/lib/format";
import { createBillAction, createRetailPlanAction } from "../../actions";

function kwh(n: number): string {
  return `${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })} kWh`;
}
function kw(n: number): string {
  return `${n.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kW`;
}

const RECON_STYLE: Record<string, string> = {
  match: "text-good",
  review: "text-warn",
  investigate: "text-bad",
};
const RECON_LABEL: Record<string, string> = {
  match: "Matches model",
  review: "Review",
  investigate: "Investigate",
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/50">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-foreground/50">{sub}</div>}
    </div>
  );
}

export default async function MeteringPointPage({
  params,
}: {
  params: Promise<{ meteringPointId: string }>;
}) {
  const { meteringPointId } = await params;
  const mp = await getMeteringPointDetail(meteringPointId);
  if (!mp) notFound();

  const [site, client, readings, bills, retailPlanRow] = await Promise.all([
    getSite(mp.siteId),
    getClient(mp.clientId),
    getReadingsForMeteringPoint(meteringPointId),
    listBillsForMeteringPoint(meteringPointId),
    getRetailPlan(meteringPointId),
  ]);
  const retailPlan = retailPlanRow ?? DEFAULT_RETAIL_PLAN;

  const summary = consumptionSummary(readings);
  const peak = peakDemand(readings);
  const avgKw = averageDemandKw(readings);
  const pf = periodPowerFactor(readings);
  const daily = dailyConsumption(readings);
  const profile = loadProfileByTimeOfDay(readings);

  // Model on the tariff this NMI is billed on (falls back to 7200), with its loss factors.
  const tariff = getTariff(mp.tariffCode ?? "") ?? ENERGEX_7200;
  const losses = {
    mlf: mp.mlf ?? undefined,
    dlf: mp.dlf ?? undefined,
    assumedPf: mp.assumedPf ?? undefined,
    connectionUnits: mp.connectionUnits ?? undefined,
  };
  const modelled = computeFullCost(readings, tariff, retailPlan, losses);

  // Per-bill reconciliation: cost the readings within each bill's period on its tariff
  // + retail plan. When the bill was entered as component buckets, reconcile component by
  // component (the headline); otherwise fall back to the total-level check.
  const reconciliations = bills.map((b) => {
    const billTariff = getTariff(b.tariffCode ?? "") ?? tariff;
    const inPeriod = readings.filter((r) => {
      const d = aestDate(r.intervalStart);
      return d >= b.periodStart && d <= b.periodEnd;
    });
    // The connection-unit count varies per bill: this bill's count wins over the NMI default.
    const billLosses = { ...losses, connectionUnits: b.connectionUnits ?? losses.connectionUnits };
    const cost = computeFullCost(inPeriod, billTariff, retailPlan, billLosses);
    const estimatedFraction = consumptionSummary(inPeriod).estimatedFraction;
    const components =
      b.billedComponents.length > 0
        ? reconcileComponents(modelledComponents(cost), b.billedComponents, {
            estimatedDataPct: estimatedFraction,
          })
        : null;
    return { bill: b, cost, recon: reconcile(cost.total, b.billedTotal), components };
  });

  return (
    <div className="flex flex-col gap-8">
      <nav className="text-sm text-foreground/50">
        <Link href="/" className="hover:underline">
          Clients
        </Link>{" "}
        /{" "}
        <Link href={`/clients/${mp.clientId}`} className="hover:underline">
          {client?.name ?? "Client"}
        </Link>{" "}
        /{" "}
        <Link href={`/sites/${mp.siteId}`} className="hover:underline">
          {site?.name ?? "Site"}
        </Link>{" "}
        / <span className="font-mono text-foreground/70">{mp.nmi}</span>
      </nav>

      <section className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">{mp.nmi}</h1>
          <p className="text-sm text-foreground/60">
            {readings.length.toLocaleString("en-AU")} interval readings
          </p>
        </div>
        {readings.length > 0 && (
          <Link
            href={`/report/${mp.id}`}
            className="rounded border border-border px-3 py-2 text-sm hover:bg-black/[0.03]"
          >
            Client report →
          </Link>
        )}
      </section>

      {readings.length === 0 ? (
        <p className="text-sm text-foreground/60">
          No interval data yet — import a NEM12 file on the{" "}
          <Link href={`/sites/${mp.siteId}`} className="underline">
            site page
          </Link>{" "}
          to see analytics here.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Consumption"
              value={kwh(summary.importKwh)}
              sub={
                summary.exportKwh > 0
                  ? `net ${kwh(summary.netKwh)} · ${kwh(summary.exportKwh)} exported`
                  : undefined
              }
            />
            <Stat label="Peak demand" value={kw(peak.kw)} sub="max interval" />
            <Stat label="Average demand" value={kw(avgKw)} />
            <Stat
              label="Power factor"
              value={pf.powerFactor === null ? "—" : pf.powerFactor.toFixed(2)}
              sub={pf.reactiveKvarh === 0 ? "no reactive data" : "period average"}
            />
          </section>

          {summary.estimatedFraction > 0 && (
            <p className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {(summary.estimatedFraction * 100).toFixed(1)}% of consumption intervals are
              estimated or substituted, not actual reads.
            </p>
          )}

          <section>
            <h2 className="font-medium">Average daily load profile</h2>
            <p className="text-xs text-foreground/50">
              Mean demand (kW) by time of day across the period.
            </p>
            <div className="mt-3">
              <BarChart
                unit="kW"
                data={profile.map((p) => ({
                  label: formatMinuteOfDay(p.minuteOfDay),
                  value: p.avgKw,
                }))}
              />
            </div>
          </section>

          <section>
            <h2 className="font-medium">Daily consumption</h2>
            <p className="text-xs text-foreground/50">Grid import (kWh) per day.</p>
            <div className="mt-3">
              <BarChart
                unit="kWh"
                data={daily.map((d) => ({ label: d.date.slice(5), value: d.importKwh }))}
              />
            </div>
          </section>

          <section>
            <h2 className="font-medium">
              Modelled cost — {tariff.name}
            </h2>
            <p className="text-xs text-foreground/50">
              Cost computed from interval data over the {modelled.days} days of data. Network
              from {tariff.name}; retail from {retailPlan.label}
              {retailPlan.estimated && " (default — set this NMI's contract below)"}.
            </p>
            <div className="mt-3 overflow-hidden rounded border border-border">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-black/5">
                  {modelled.lines.map((l) => (
                    <tr key={l.label}>
                      <td className="px-4 py-2">
                        {l.label}
                        <span className="ml-2 text-xs uppercase text-foreground/40">
                          {l.category}
                        </span>
                        {l.detail && (
                          <div className="text-xs text-foreground/50">{l.detail}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {moneyLabel(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-medium">
                  <tr>
                    <td className="px-4 py-2">
                      Network {moneyLabel(modelled.networkTotal)} · Retail{" "}
                      {moneyLabel(modelled.retailTotal)}
                    </td>
                    <td className="px-4 py-2 text-right text-base tabular-nums">
                      {moneyLabel(modelled.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="rounded border border-border p-4">
            <h2 className="font-medium">Retail plan (this NMI)</h2>
            <p className="mt-1 text-xs text-foreground/60">
              Enter this NMI&apos;s retail contract rates (ex-GST). Currently using{" "}
              <strong>{retailPlan.label}</strong>.
            </p>
            <form action={createRetailPlanAction} className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
              <input type="hidden" name="meteringPointId" value={mp.id} />
              <input type="hidden" name="clientId" value={mp.clientId} />
              {[
                ["peakRate", "Energy peak $/kWh", retailPlan.peakRatePerKwh],
                ["offpeakRate", "Energy off-peak $/kWh", retailPlan.offpeakRatePerKwh],
                ["environmentalRate", "Environmental $/kWh", retailPlan.environmentalPerKwh],
                ["marketRate", "Market/AEMO $/kWh", retailPlan.marketPerKwh],
                ["supplyPerDay", "Supply $/day", retailPlan.supplyPerDay],
                ["meteringPerDay", "Metering $/day", retailPlan.meteringPerDay],
                ["peakStartHour", "Peak start (hour)", retailPlan.peakWindow.ranges[0]?.startMin / 60],
                ["peakEndHour", "Peak end (hour)", retailPlan.peakWindow.ranges[0]?.endMin / 60],
              ].map(([name, label, def]) => (
                <label key={name as string} className="flex flex-col gap-1 text-xs text-foreground/60">
                  {label as string}
                  <input
                    name={name as string}
                    type="number"
                    step="any"
                    defaultValue={Number(def)}
                    className="rounded border border-border px-3 py-2 text-sm text-foreground"
                  />
                </label>
              ))}
              <SubmitButton
                className="col-span-2 justify-self-start rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white md:col-span-3"
                pendingText="Saving…"
              >
                Save retail plan
              </SubmitButton>
            </form>
          </section>

          <section>
            <h2 className="font-medium">Bills &amp; reconciliation</h2>
            <p className="text-xs text-foreground/50">
              Enter the bill (ex-GST) as component buckets for the period; each is compared,
              component by component, to the cost modelled from interval data — so you can see
              exactly where the bill disagrees. Leave a bucket blank if it&apos;s not on the bill.
              The total is summed automatically.
            </p>

            {reconciliations.length > 0 && (
              <ul className="mt-3 flex flex-col gap-4">
                {reconciliations.map(({ bill, cost, recon, components }) => (
                  <li key={bill.id} className="rounded border border-border p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {bill.periodStart} → {bill.periodEnd}
                        {bill.retailer ? ` · ${bill.retailer}` : ""}
                      </span>
                      {!components && (
                        <span className={`text-xs font-semibold ${RECON_STYLE[recon.status]}`}>
                          {RECON_LABEL[recon.status]}
                        </span>
                      )}
                    </div>
                    {components ? (
                      <div className="mt-3">
                        <ReconciliationTable result={components} />
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-foreground/60">
                        Billed {moneyLabel(bill.billedTotal)} · Modelled {moneyLabel(cost.total)} ·
                        Variance {moneyLabel(recon.variance)} (
                        {(recon.variancePct * 100).toFixed(1)}%). Total-level only — re-enter as
                        component buckets to see where the bill disagrees.
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form
              action={createBillAction}
              className="mt-4 grid grid-cols-2 gap-3 rounded border border-border p-4"
            >
              <input type="hidden" name="meteringPointId" value={mp.id} />
              <input type="hidden" name="clientId" value={mp.clientId} />
              <input type="hidden" name="tariffCode" value={tariff.code} />
              <label className="col-span-2 flex flex-col gap-1 text-xs text-foreground/60">
                Retailer
                <input
                  name="retailer"
                  placeholder="e.g. Origin"
                  className="rounded border border-border px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Period start
                <input
                  type="date"
                  name="periodStart"
                  required
                  className="rounded border border-border px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Period end
                <input
                  type="date"
                  name="periodEnd"
                  required
                  className="rounded border border-border px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-foreground/60">
                Connection units on this bill (11kV/7400 — the count on the connection unit charge line; blank = NMI default{mp.connectionUnits != null ? ` ${mp.connectionUnits}` : ""})
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  name="connectionUnits"
                  placeholder="—"
                  className="rounded border border-border px-3 py-2 text-sm text-foreground"
                />
              </label>
              <div className="col-span-2 mt-1 text-[11px] uppercase tracking-wide text-foreground/40">
                Billed components (ex-GST, AUD)
              </div>
              {(
                [
                  ["energyPeak", "Energy — peak"],
                  ["energyShoulder", "Energy — shoulder"],
                  ["energyOffpeak", "Energy — off-peak"],
                  ["demand", "Demand"],
                  ["supply", "Supply / fixed"],
                  ["metering", "Metering"],
                  ["environmental", "Environmental (pass-through)"],
                  ["market", "Market / AEMO (pass-through)"],
                  ["other", "Other"],
                ] as const
              ).map(([name, label]) => (
                <label key={name} className="flex flex-col gap-1 text-xs text-foreground/60">
                  {label}
                  <input
                    type="number"
                    step="0.01"
                    name={name}
                    placeholder="—"
                    className="rounded border border-border px-3 py-2 text-sm text-foreground"
                  />
                </label>
              ))}
              <SubmitButton
                className="col-span-2 justify-self-start rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white"
                pendingText="Reconciling…"
              >
                Add bill &amp; reconcile
              </SubmitButton>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
