import { createSupabaseServerClient } from "@/data/supabase/server";
import {
  type BillComponent,
  parseComponentKey,
  natureOf,
} from "@/core/reconciliation";

export interface Bill {
  id: string;
  clientId: string;
  meteringPointId: string;
  retailer: string | null;
  tariffCode: string | null;
  tariffName: string | null;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  billedTotal: number; // ex-GST
  notes: string | null;
  createdAt: string;
  /** This bill's connection-unit count (varies per bill); null → use the NMI default. */
  connectionUnits: number | null;
  /** Billed side decomposed into canonical components (empty for total-only legacy bills). */
  billedComponents: BillComponent[];
}

interface BillLineItemRow {
  label: string;
  category: string | null;
  amount: number | string;
  component: string | null;
}

interface BillRow {
  id: string;
  client_id: string;
  metering_point_id: string;
  retailer: string | null;
  tariff_code: string | null;
  tariff_name: string | null;
  period_start: string;
  period_end: string;
  billed_total: number | string;
  notes: string | null;
  created_at: string;
  connection_units: number | string | null;
  bill_line_item?: BillLineItemRow[] | null;
}

/** Reconstruct canonical billed components from stored line items (only those with a component key). */
function toBilledComponents(rows: BillLineItemRow[] | null | undefined): BillComponent[] {
  if (!rows) return [];
  return rows
    .filter((r) => r.component)
    .map((r) => {
      const { kind, subKey } = parseComponentKey(r.component as string);
      return {
        kind,
        subKey,
        label: r.label,
        amount: Number(r.amount) || 0,
        nature: natureOf(kind),
      };
    });
}

function toBill(r: BillRow): Bill {
  return {
    id: r.id,
    clientId: r.client_id,
    meteringPointId: r.metering_point_id,
    retailer: r.retailer,
    tariffCode: r.tariff_code,
    tariffName: r.tariff_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    billedTotal: Number(r.billed_total) || 0,
    notes: r.notes,
    createdAt: r.created_at,
    connectionUnits: r.connection_units === null ? null : Number(r.connection_units),
    billedComponents: toBilledComponents(r.bill_line_item),
  };
}

const COLS =
  "id, client_id, metering_point_id, retailer, tariff_code, tariff_name, period_start, period_end, billed_total, notes, created_at, connection_units, bill_line_item ( label, category, amount, component )";

export async function listBillsForMeteringPoint(
  meteringPointId: string,
): Promise<Bill[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("bill")
    .select(COLS)
    .eq("metering_point_id", meteringPointId)
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data as BillRow[]).map(toBill);
}

/** One billed component to persist as a line item: its taxonomy key, label and amount (ex-GST). */
export interface NewBillComponent {
  component: string; // "kind:subKey" key, e.g. "energy:peak"
  label: string;
  category?: string; // "network" | "retail" | null
  amount: number;
}

export interface NewBill {
  clientId: string;
  meteringPointId: string;
  retailer?: string;
  tariffCode?: string;
  tariffName?: string;
  periodStart: string;
  periodEnd: string;
  billedTotal: number;
  notes?: string;
  /** This bill's connection-unit count (off the bill); omit to use the NMI default. */
  connectionUnits?: number;
  /** Component buckets entered by the operator; stored as bill_line_item rows. */
  components?: NewBillComponent[];
}

export async function createBill(input: NewBill): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("bill")
    .insert({
      client_id: input.clientId,
      metering_point_id: input.meteringPointId,
      retailer: input.retailer || null,
      tariff_code: input.tariffCode || null,
      tariff_name: input.tariffName || null,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      billed_total: input.billedTotal,
      notes: input.notes || null,
      connection_units: input.connectionUnits ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const billId = (data as { id: string }).id;

  // Persist the component buckets as line items, tenant-stamped from the bill's client.
  if (input.components && input.components.length > 0) {
    const { error: liError } = await supabase.from("bill_line_item").insert(
      input.components.map((c) => ({
        bill_id: billId,
        client_id: input.clientId,
        label: c.label,
        category: c.category ?? null,
        amount: c.amount,
        component: c.component,
      })),
    );
    if (liError) throw liError;
  }
  return billId;
}
