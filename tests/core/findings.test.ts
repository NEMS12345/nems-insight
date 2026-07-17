import { describe, it, expect } from "vitest";
import {
  reconcile,
  deriveFindings,
  type BillComponent,
} from "@/core/reconciliation";

// The v1.1 findings engine: (modelled, billed) → reconcile → deriveFindings → Finding[]
// with reason codes. This is the money logic — test the spec's four cases hard:
// matching lines, tolerance, a demand-charge overcharge, missing/extra lines.

const modelled: BillComponent[] = [
  { kind: "energy", subKey: "peak", label: "Energy peak", amount: 1200, nature: "modelled" },
  { kind: "energy", subKey: "offpeak", label: "Energy off-peak", amount: 400, nature: "modelled" },
  { kind: "demand", label: "Demand (kVA)", amount: 900, nature: "modelled" },
  { kind: "supply", label: "Supply charge", amount: 300, nature: "modelled" },
  { kind: "environmental", label: "LGC/STC pass-through", amount: 150, nature: "pass-through" },
];

function clone(src: BillComponent[]): BillComponent[] {
  return src.map((c) => ({ ...c }));
}
function findingFor(findings: ReturnType<typeof deriveFindings>, kind: string, subKey?: string) {
  const f = findings.find((x) => x.kind === kind && (subKey === undefined || x.subKey === subKey));
  if (!f) throw new Error(`no finding for ${kind}/${subKey}`);
  return f;
}

describe("deriveFindings — matching lines", () => {
  it("marks every matching modelled line within_tolerance and pass-throughs pass_through", () => {
    const findings = deriveFindings(reconcile(modelled, clone(modelled)));
    expect(findings).toHaveLength(modelled.length);
    for (const f of findings) {
      if (f.kind === "environmental") expect(f.reasonCode).toBe("pass_through");
      else expect(f.reasonCode).toBe("within_tolerance");
    }
  });
});

describe("deriveFindings — tolerance boundaries", () => {
  it("stays within_tolerance under the $ tolerance and flags beyond both tolerances", () => {
    const inside = clone(modelled);
    inside[3].amount = 304; // +$4 on $300 — under the $5 absolute tolerance
    expect(findingFor(deriveFindings(reconcile(modelled, inside)), "supply").reasonCode).toBe(
      "within_tolerance",
    );

    const outside = clone(modelled);
    outside[3].amount = 390; // +$90 / +30% — breaches both
    const f = findingFor(deriveFindings(reconcile(modelled, outside)), "supply");
    expect(f.reasonCode).toBe("overcharge");
    expect(f.severity).toBe("investigate");
    expect(f.varianceAud).toBe(90);
  });

  it("flags an undercharge with its own reason code (sign matters)", () => {
    const billed = clone(modelled);
    billed[0].amount = 1000; // billed $200 UNDER modelled peak energy
    const f = findingFor(deriveFindings(reconcile(modelled, billed)), "energy", "peak");
    expect(f.reasonCode).toBe("undercharge");
    expect(f.varianceAud).toBe(-200);
  });
});

describe("deriveFindings — demand-charge overcharge (the classic recovery case)", () => {
  it("names the demand overcharge with amount and severity for the recovery pipeline", () => {
    const billed = clone(modelled);
    billed[2].amount = 1150; // demand billed $250 over the modelled $900 (~28%)
    const findings = deriveFindings(reconcile(modelled, billed));
    const demand = findingFor(findings, "demand");
    expect(demand.reasonCode).toBe("overcharge");
    expect(demand.severity).toBe("investigate");
    expect(demand.varianceAud).toBe(250);
    // the rest of the bill is clean — exactly one triageable error
    const errors = findings.filter(
      (f) => f.reasonCode === "overcharge" || f.reasonCode === "undercharge",
    );
    expect(errors).toHaveLength(1);
  });
});

describe("deriveFindings — missing and extra lines", () => {
  it("maps a modelled-but-unbilled line to not_billed", () => {
    const billed = clone(modelled).filter((c) => c.kind !== "demand"); // bill omits demand
    const f = findingFor(deriveFindings(reconcile(modelled, billed)), "demand");
    expect(f.reasonCode).toBe("not_billed");
    expect(f.billedAud).toBeNull();
    expect(f.varianceAud).toBe(-900);
  });

  it("maps a billed-but-unmodelled line to not_modelled", () => {
    const billed = clone(modelled);
    billed.push({ kind: "retailer_fixed", label: "Mystery fee", amount: 75, nature: "modelled" });
    const f = findingFor(deriveFindings(reconcile(modelled, billed)), "retailer_fixed");
    expect(f.reasonCode).toBe("not_modelled");
    expect(f.modelledAud).toBeNull();
    expect(f.varianceAud).toBe(75);
  });
});
