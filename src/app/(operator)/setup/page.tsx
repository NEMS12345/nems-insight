import Link from "next/link";
import { setupOverview } from "@/data/repositories/assignments";
import { listNetworkTariffs } from "@/data/repositories/networkTariffs";
import { SubmitButton } from "@/components/SubmitButton";
import { assignTariffAction } from "../actions";

/**
 * [v1.1] Setup — assign a network tariff + retail contract to each NMI. An NMI without an
 * assignment CANNOT be modelled (shown here as a blocking state, never a silent fallback).
 * Contracts are entered on the NMI page (rates belong with the NMI); this page binds the
 * pieces together and shows portfolio-wide setup state at a glance.
 */
export default async function SetupPage() {
  const [{ rows, contractGroups }, tariffs] = await Promise.all([
    setupOverview(),
    listNetworkTariffs(),
  ]);

  // One picker option per tariff code (versions collapse to the code).
  const tariffCodes = [...new Map(tariffs.map((t) => [t.code, t.name])).entries()];
  const unassigned = rows.filter((r) => !r.assignment);
  const assigned = rows.filter((r) => r.assignment);

  return (
    <div className="flex flex-col gap-8">
      <nav className="text-sm text-foreground/50">
        <Link href="/" className="hover:underline">
          Clients
        </Link>{" "}
        / <span className="text-foreground/70">Setup</span>
      </nav>

      <section>
        <h1 className="text-xl font-semibold">Setup — tariff &amp; contract assignment</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Every NMI needs a network tariff and a retail contract before it can be modelled.
          {unassigned.length > 0
            ? ` ${unassigned.length} of ${rows.length} NMIs are blocked.`
            : rows.length > 0
              ? " All NMIs are assigned."
              : " No NMIs yet — create a client → site → NMI first."}
        </p>
      </section>

      {unassigned.length > 0 && (
        <section>
          <h2 className="font-medium text-bad">Blocked — cannot model</h2>
          <ul className="mt-2 divide-y divide-border rounded border-2 border-bad/30">
            {unassigned.map((r) => {
              const groups = contractGroups.filter((g) => g.clientId === r.clientId);
              return (
                <li key={r.meteringPointId} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      <Link
                        href={`/metering-points/${r.meteringPointId}`}
                        className="font-mono hover:underline"
                      >
                        {r.nmi}
                      </Link>{" "}
                      <span className="text-foreground/50">
                        · {r.clientName} · {r.siteName}
                      </span>
                    </span>
                    <span className="rounded bg-bad/10 px-2 py-0.5 text-xs font-medium text-bad">
                      Not assigned
                    </span>
                  </div>
                  {groups.length === 0 ? (
                    <p className="mt-2 text-xs text-foreground/60">
                      No retail contract on file for {r.clientName} yet — enter one on the{" "}
                      <Link
                        href={`/metering-points/${r.meteringPointId}`}
                        className="underline"
                      >
                        NMI page
                      </Link>{" "}
                      (that assigns it in one step).
                    </p>
                  ) : (
                    <form
                      action={assignTariffAction}
                      className="mt-2 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="meteringPointId" value={r.meteringPointId} />
                      <input type="hidden" name="clientId" value={r.clientId} />
                      <label className="flex flex-col gap-1 text-xs text-foreground/60">
                        Network tariff
                        <select
                          name="networkTariffCode"
                          defaultValue={r.tariffCodeHint ?? tariffCodes[0]?.[0]}
                          className="rounded border border-border px-2 py-1.5 text-sm"
                        >
                          {tariffCodes.map(([code, name]) => (
                            <option key={code} value={code}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-foreground/60">
                        Retail contract
                        <select
                          name="retailContractGroup"
                          className="rounded border border-border px-2 py-1.5 text-sm"
                        >
                          {groups.map((g) => (
                            <option key={g.groupId} value={g.groupId}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-foreground/60">
                        Effective from (optional)
                        <input
                          type="date"
                          name="effectiveFrom"
                          className="rounded border border-border px-2 py-1.5 text-sm"
                        />
                      </label>
                      <SubmitButton
                        className="rounded bg-accent hover:bg-accent-hover px-3 py-1.5 text-sm text-white"
                        pendingText="Assigning…"
                      >
                        Assign
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-medium">Assigned</h2>
        {assigned.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/60">Nothing assigned yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded border border-border">
            {assigned.map((r) => (
              <li
                key={r.meteringPointId}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span>
                  <Link
                    href={`/metering-points/${r.meteringPointId}`}
                    className="font-mono hover:underline"
                  >
                    {r.nmi}
                  </Link>{" "}
                  <span className="text-foreground/50">
                    · {r.clientName} · {r.siteName}
                  </span>
                </span>
                <span className="text-xs text-foreground/60">
                  Tariff {r.assignment!.networkTariffCode} ·{" "}
                  {contractGroups.find(
                    (g) => g.groupId === r.assignment!.retailContractGroup,
                  )?.label ?? "contract"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
