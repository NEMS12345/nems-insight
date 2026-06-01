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
} from "@/core/analytics";
import { BarChart } from "@/components/BarChart";

function kwh(n: number): string {
  return `${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })} kWh`;
}
function kw(n: number): string {
  return `${n.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kW`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-black/10 p-4">
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

  const [site, client, readings] = await Promise.all([
    getSite(mp.siteId),
    getClient(mp.clientId),
    getReadingsForMeteringPoint(meteringPointId),
  ]);

  const summary = consumptionSummary(readings);
  const peak = peakDemand(readings);
  const avgKw = averageDemandKw(readings);
  const pf = periodPowerFactor(readings);
  const daily = dailyConsumption(readings);
  const profile = loadProfileByTimeOfDay(readings);

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

      <section>
        <h1 className="font-mono text-xl font-semibold">{mp.nmi}</h1>
        <p className="text-sm text-foreground/60">
          {readings.length.toLocaleString("en-AU")} interval readings
        </p>
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
        </>
      )}
    </div>
  );
}
