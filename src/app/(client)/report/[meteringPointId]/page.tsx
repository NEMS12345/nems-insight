import { notFound } from "next/navigation";
import {
  getMeteringPointDetail,
  getReadingsForMeteringPoint,
} from "@/data/repositories/readings";
import { getSite } from "@/data/repositories/sites";
import { getClient } from "@/data/repositories/clients";
import { listBillsForMeteringPoint } from "@/data/repositories/bills";
import {
  consumptionSummary,
  peakDemand,
  averageDemandKw,
  loadFactor,
  periodPowerFactor,
  loadProfileByTimeOfDay,
  dailyConsumption,
  formatMinuteOfDay,
  recommendSolar,
} from "@/core/analytics";
import {
  computeCost,
  compareTariffs,
  reconcile,
  getTariff,
  marginalEnergyRatePerKwh,
  ENERGEX_7200,
  ENERGEX_7400,
  type LossFactors,
} from "@/core/tariff";
import { BarChart } from "@/components/BarChart";
import { PrintButton } from "@/components/PrintButton";
import { moneyLabel, energyLabel } from "@/lib/format";

const ALL_TARIFFS = [ENERGEX_7200, ENERGEX_7400];

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function kw(n: number): string {
  return `${n.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kW`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-black/10 pt-6">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-black/10 p-3">
      <div className="text-[11px] uppercase tracking-wide text-black/50">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-black/50">{sub}</div>}
    </div>
  );
}

export default async function ClientReport({
  params,
}: {
  params: Promise<{ meteringPointId: string }>;
}) {
  const { meteringPointId } = await params;
  const mp = await getMeteringPointDetail(meteringPointId);
  if (!mp) notFound();

  const [site, client, readings, bills] = await Promise.all([
    getSite(mp.siteId),
    getClient(mp.clientId),
    getReadingsForMeteringPoint(meteringPointId),
    listBillsForMeteringPoint(meteringPointId),
  ]);

  const tariff = getTariff(mp.tariffCode ?? "") ?? ENERGEX_7200;
  const losses: LossFactors = { mlf: mp.mlf ?? undefined, dlf: mp.dlf ?? undefined };

  const summary = consumptionSummary(readings);
  const peak = peakDemand(readings);
  const lf = loadFactor(readings);
  const pf = periodPowerFactor(readings);
  const profile = loadProfileByTimeOfDay(readings);
  const daily = dailyConsumption(readings);
  const modelled = computeCost(readings, tariff, losses);

  // Tariff comparison (cheapest first) and the saving vs the current tariff.
  const ranked = compareTariffs(readings, ALL_TARIFFS, losses);
  const current = ranked.find((o) => o.tariff.code === tariff.code) ?? ranked[0];
  const cheapest = ranked[0];
  const tariffSaving = current.cost.total - cheapest.cost.total;
  const switchWorthwhile = cheapest.tariff.code !== tariff.code && tariffSaving > 0;

  // Solar (sized to minimise export); value a self-consumed kWh at the daytime/peak rate.
  const avoidedRate = marginalEnergyRatePerKwh(tariff, "peak", losses);
  const solar = recommendSolar(readings, avoidedRate);

  const reconciliations = bills.map((b) => {
    const bt = getTariff(b.tariffCode ?? "") ?? tariff;
    const inPeriod = readings.filter((r) => {
      const d = r.intervalStart.slice(0, 10);
      return d >= b.periodStart && d <= b.periodEnd;
    });
    return { bill: b, cost: computeCost(inPeriod, bt, losses), };
  }).map(({ bill, cost }) => ({ bill, cost, recon: reconcile(cost.total, bill.billedTotal) }));

  const periodStart = daily[0]?.date ?? "—";
  const periodEnd = daily[daily.length - 1]?.date ?? "—";

  // Build the recommendations list.
  const recommendations: string[] = [];
  if (switchWorthwhile) {
    recommendations.push(
      `Review network tariff: re-costing your load on ${cheapest.tariff.name} indicates ~${moneyLabel(tariffSaving)}/yr lower cost than the current ${tariff.name} (subject to connection/voltage eligibility).`,
    );
  }
  if (pf.powerFactor !== null && pf.powerFactor < 0.9) {
    recommendations.push(
      `Power factor is ${pf.powerFactor.toFixed(2)} — correcting it would reduce the kVA demand charge.`,
    );
  }
  if (lf > 0 && lf < 0.4) {
    recommendations.push(
      `Load factor is ${lf.toFixed(2)} (peaky). Reducing the in-window peak demand would cut the $/kVA (or $/kW) demand charge.`,
    );
  }
  if (solar.recommendedKwp > 0 && solar.simplePaybackYears) {
    recommendations.push(
      `Install ~${solar.recommendedKwp} kWp of solar (sized to minimise export): ~${moneyLabel(solar.annualSavingAud)}/yr saving, ~${solar.simplePaybackYears.toFixed(1)} year simple payback.`,
    );
  }
  const investigate = reconciliations.find((r) => r.recon.status === "investigate");
  if (investigate) {
    recommendations.push(
      `Investigate the ${investigate.bill.periodStart}–${investigate.bill.periodEnd} bill: ${moneyLabel(Math.abs(investigate.recon.variance))} (${pct(Math.abs(investigate.recon.variancePct))}) away from the modelled cost.`,
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-8 text-black">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-black/50">Energy review — NEMS Insight</div>
          <h1 className="text-2xl font-bold">{client?.name ?? "Client"}</h1>
          <div className="text-sm text-black/60">
            {site?.name} · NMI <span className="font-mono">{mp.nmi}</span> ·{" "}
            {periodStart} to {periodEnd}
          </div>
        </div>
        <PrintButton />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <Section title="Summary">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Annual cost (modelled)" value={moneyLabel(modelled.total)} />
            <Metric label="Consumption" value={energyLabel(summary.importKwh)} />
            <Metric label="Peak demand" value={kw(peak.kw)} />
            <Metric label="Load factor" value={lf.toFixed(2)} />
          </div>
          {recommendations.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium">Recommendations</div>
              <ul className="mt-1 list-disc pl-5 text-sm text-black/80">
                {recommendations.map((r, i) => (
                  <li key={i} className="mt-1">{r}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Usage profile">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Average demand" value={kw(averageDemandKw(readings))} />
            <Metric label="Power factor" value={pf.powerFactor === null ? "—" : pf.powerFactor.toFixed(2)} />
            <Metric label="Export (solar)" value={energyLabel(summary.exportKwh)} />
            <Metric label="Estimated data" value={pct(summary.estimatedFraction)} />
          </div>
          <div className="mt-4 text-xs text-black/50">Average daily load profile (kW by time of day)</div>
          <BarChart unit="kW" data={profile.map((p) => ({ label: formatMinuteOfDay(p.minuteOfDay), value: p.avgKw }))} />
        </Section>

        <Section title="Where the money goes">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-black/5">
              {modelled.lines.map((l) => (
                <tr key={l.label}>
                  <td className="py-1.5">
                    {l.label} <span className="text-[10px] uppercase text-black/40">{l.category}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{moneyLabel(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-black/20 font-medium">
              <tr>
                <td className="py-2">Network {moneyLabel(modelled.networkTotal)} · Retail {moneyLabel(modelled.retailTotal)}</td>
                <td className="py-2 text-right tabular-nums">{moneyLabel(modelled.total)}</td>
              </tr>
            </tfoot>
          </table>
        </Section>

        {reconciliations.length > 0 && (
          <Section title="Bill reconciliation">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-black/5">
                {reconciliations.map(({ bill, cost, recon }) => (
                  <tr key={bill.id}>
                    <td className="py-1.5">{bill.periodStart}–{bill.periodEnd}{bill.retailer ? ` · ${bill.retailer}` : ""}</td>
                    <td className="py-1.5 text-right tabular-nums">billed {moneyLabel(bill.billedTotal)}</td>
                    <td className="py-1.5 text-right tabular-nums">modelled {moneyLabel(cost.total)}</td>
                    <td className="py-1.5 text-right font-medium">{recon.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <Section title="Network tariff check">
          <p className="text-sm text-black/80">
            This metering point is modelled on <strong>{tariff.name}</strong>.
            {switchWorthwhile ? (
              <>
                {" "}On this load, <strong>{cheapest.tariff.name}</strong> would cost about{" "}
                <strong>{moneyLabel(tariffSaving)}/yr less</strong> — worth reviewing, subject to
                connection/voltage eligibility.
              </>
            ) : (
              <> It is the lowest-cost of the tariffs assessed for this load.</>
            )}
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-black/5">
              {ranked.map((o) => (
                <tr key={o.tariff.code} className={o.tariff.code === tariff.code ? "font-medium" : ""}>
                  <td className="py-1.5">{o.tariff.name}{o.tariff.code === tariff.code ? " (current)" : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{moneyLabel(o.cost.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Solar opportunity">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Recommended size" value={`${solar.recommendedKwp} kWp`} sub="sized to minimise export" />
            <Metric label="Annual generation" value={energyLabel(solar.annualGenerationKwh)} sub={`${pct(solar.selfConsumptionPct)} self-consumed`} />
            <Metric label="Est. annual saving" value={moneyLabel(solar.annualSavingAud)} />
            <Metric label="Simple payback" value={solar.simplePaybackYears ? `${solar.simplePaybackYears.toFixed(1)} yrs` : "—"} sub={`~${solar.co2OffsetTonnes.toFixed(0)} t CO₂/yr`} />
          </div>
          <p className="mt-3 text-xs text-black/50">
            Indicative only (not a feasibility study). Assumes {solar.assumptions.yieldKwhPerKwpYear} kWh/kWp/yr
            (SE QLD), ~${solar.assumptions.installCostPerWatt.toFixed(2)}/W installed, a self-consumed kWh valued
            at {moneyLabel(avoidedRate)}/kWh, and available roof/space. Existing on-site generation is netted from the load.
          </p>
        </Section>

        <Section title="Basis & assumptions">
          <ul className="list-disc pl-5 text-xs text-black/60">
            <li>Costs are modelled from interval meter data on the {tariff.name} tariff (network published; retail per the client&apos;s Origin invoice), ex-GST.</li>
            <li>Loss factors applied: MLF {losses.mlf ?? "—"}, DLF {losses.dlf ?? "—"}. Retail energy peak window assumed 7am–9pm weekdays.</li>
            <li>{readings.length.toLocaleString("en-AU")} interval readings over {modelled.days} days; {pct(summary.estimatedFraction)} estimated/substituted.</li>
          </ul>
        </Section>
      </div>
    </main>
  );
}
