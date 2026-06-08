// Canonical bill-component taxonomy for reconciliation. A retailer bill is decomposed into a
// fixed set of component kinds so the modelled cost and the declared (billed) cost can be
// compared like-for-like, component by component — not just at the bottom line. Each component
// is tagged as either MODELLED (we compute it from interval data + the tariff, so a variance is
// a real billing-error signal) or PASS-THROUGH (a declared charge we do not independently model
// — environmental certificates, market/AEMO fees, GST — where a variance is informational only
// and must NOT count as a billing error).
//
// Pure TypeScript — no DB/framework imports (CLAUDE.md §3).

export type ComponentKind =
  | "energy" // consumption charges, usually split by ToU period (subKey)
  | "demand" // kW/kVA demand charges
  | "supply" // daily supply / fixed standing charge
  | "network_other" // other network charges not in the above buckets
  | "environmental" // environmental certificate costs (LGC/STC/LRET/SRES etc.)
  | "metering" // metering / data agent charges
  | "market_fees" // market operator fees (AEMO participant/ancillary)
  | "retailer_fixed" // retailer fixed/membership charges
  | "gst" // goods & services tax
  | "other"; // anything uncategorised

/**
 * Whether a component is independently modelled from interval data (so a variance signals a
 * possible billing error) or a declared pass-through (variance is informational only).
 */
export type ComponentNature = "modelled" | "pass-through";

/**
 * One line of cost, on either the modelled side or the billed side. Amounts are AUD and
 * ex-GST EXCEPT the `gst` component itself. Components are matched across the two sides by
 * their key = `${kind}:${subKey ?? ""}` (e.g. "energy:peak", "demand:").
 */
export interface BillComponent {
  kind: ComponentKind;
  /** Sub-bucket within a kind, e.g. the ToU period "peak"/"shoulder"/"offpeak" for energy. */
  subKey?: string;
  label: string;
  amount: number; // AUD
  nature: ComponentNature;
}

/** The matching key for a component: kind plus optional sub-bucket. */
export function componentKey(c: Pick<BillComponent, "kind" | "subKey">): string {
  return `${c.kind}:${c.subKey ?? ""}`;
}
