import { describe, it, expect } from "vitest";
import { reconcile, type BillComponent } from "@/core/reconciliation";

// A representative modelled breakdown for one month (AUD, ex-GST except the gst line).
const modelled: BillComponent[] = [
  { kind: "energy", subKey: "peak", label: "Energy peak", amount: 1200, nature: "modelled" },
  { kind: "energy", subKey: "offpeak", label: "Energy off-peak", amount: 400, nature: "modelled" },
  { kind: "demand", label: "Demand (kVA)", amount: 900, nature: "modelled" },
  { kind: "supply", label: "Supply charge", amount: 300, nature: "modelled" },
  { kind: "environmental", label: "LGC/STC pass-through", amount: 150, nature: "pass-through" },
  { kind: "market_fees", label: "AEMO market fees", amount: 50, nature: "pass-through" },
  { kind: "gst", label: "GST", amount: 305, nature: "pass-through" },
];

/** Deep-clone the fixture so each test can tweak it independently. */
function clone(src: BillComponent[]): BillComponent[] {
  return src.map((c) => ({ ...c }));
}

describe("reconcile — clean match", () => {
  it("returns judgement 'match' when billed equals modelled within tolerance", () => {
    const billed = clone(modelled);
    // nudge one component by under the absolute tolerance ($5 default)
    billed[0].amount = 1203;
    const res = reconcile(modelled, billed);
    expect(res.judgement).toBe("match");
    expect(res.components.filter((c) => c.nature === "modelled").every((c) => c.status === "match")).toBe(true);
    expect(res.netVarianceAud).toBe(3);
  });
});

describe("reconcile — over-charge on one modelled component", () => {
  it("flags only the over-charged component as investigate", () => {
    const billed = clone(modelled);
    billed[2].amount = 1100; // demand over-charged by $200 (>2% and >$5)
    const res = reconcile(modelled, billed);

    const demand = res.components.find((c) => c.kind === "demand")!;
    expect(demand.status).toBe("investigate");
    expect(demand.varianceAud).toBe(200);
    expect(demand.variancePct).toBeCloseTo(200 / 900, 5);

    // other modelled components stay clean
    const others = res.components.filter((c) => c.nature === "modelled" && c.kind !== "demand");
    expect(others.every((c) => c.status === "match")).toBe(true);

    expect(res.judgement).toBe("investigate");
    expect(res.netVarianceAud).toBe(200);
  });

  it("dual tolerance: a tiny absolute over-charge with a big percent is only 'review'", () => {
    const m: BillComponent[] = [{ kind: "metering", label: "Metering", amount: 2, nature: "modelled" }];
    const b: BillComponent[] = [{ kind: "metering", label: "Metering", amount: 4, nature: "modelled" }];
    // +$2 is 100% but under the $5 absolute tolerance → review, not investigate.
    const res = reconcile(m, b);
    expect(res.components[0].status).toBe("review");
    expect(res.judgement).toBe("review");
  });
});

describe("reconcile — pass-through excluded from billing-error judgement", () => {
  it("a large variance on a pass-through line does not make the bill an error", () => {
    const billed = clone(modelled);
    billed[4].amount = 600; // environmental pass-through quadrupled
    const res = reconcile(modelled, billed);

    const env = res.components.find((c) => c.kind === "environmental")!;
    expect(env.status).toBe("pass-through");
    expect(env.varianceAud).toBe(450);

    // judgement ignores pass-through entirely
    expect(res.judgement).toBe("match");
    // and the modelled bottom line excludes it
    expect(res.modelledTotalAud).toBe(1200 + 400 + 900 + 300);
    expect(res.passThroughBilledAud).toBe(600 + 50 + 305);
  });
});

describe("reconcile — estimated data lowers confidence, doesn't manufacture errors", () => {
  it("a heavily-estimated month with a real-looking variance reads as low-confidence", () => {
    const billed = clone(modelled);
    billed[0].amount = 1500; // peak energy +$300 — would normally be investigate
    const res = reconcile(modelled, billed, { estimatedDataPct: 0.45 });

    // the component variance is still computed and visible
    const peak = res.components.find((c) => c.kind === "energy" && c.subKey === "peak")!;
    expect(peak.status).toBe("investigate");
    // but the overall judgement is downgraded to low-confidence, not a billing error
    expect(res.confidence).toBe("low");
    expect(res.judgement).toBe("low-confidence");
  });

  it("stays 'ok' confidence below the estimated-data threshold", () => {
    const res = reconcile(modelled, clone(modelled), { estimatedDataPct: 0.05 });
    expect(res.confidence).toBe("ok");
    expect(res.judgement).toBe("match");
  });
});

describe("reconcile — missing / extra components", () => {
  it("marks a modelled component absent from the bill as 'unbilled'", () => {
    const billed = clone(modelled).filter((c) => c.kind !== "demand");
    const res = reconcile(modelled, billed);
    const demand = res.components.find((c) => c.kind === "demand")!;
    expect(demand.status).toBe("unbilled");
    expect(demand.billedAud).toBeNull();
    expect(res.judgement).toBe("investigate");
  });

  it("marks a billed modelled component we didn't model as 'unmodelled'", () => {
    const billed = clone(modelled);
    billed.push({ kind: "network_other", label: "Surprise network charge", amount: 75, nature: "modelled" });
    const res = reconcile(modelled, billed);
    const extra = res.components.find((c) => c.kind === "network_other")!;
    expect(extra.status).toBe("unmodelled");
    expect(extra.modelledAud).toBeNull();
  });
});
