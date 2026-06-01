// Retail energy benchmarking from a wholesale futures price.
//
// The ASX QLD electricity futures price (a flat base-load $/MWh forward) is the right basis
// brokers use, but it's the wholesale slice only and is licensed data — so it's an INPUT
// here (entered per review, or a licensed feed later), and we build the benchmark retail
// rate from it. A peaky C&I load costs more than base load, so a load-shape uplift applies.

export interface RetailBenchmarkAssumptions {
  /** Retailer gross margin, $/kWh. */
  retailMarginPerKwh: number;
  /** Environmental certificate cost (LGC/STC), $/kWh. */
  environmentalPerKwh: number;
  /** Market/AEMO fees, $/kWh. */
  marketFeesPerKwh: number;
  /** Combined loss uplift (MLF×DLF) applied to the wholesale component. */
  lossUplift: number;
  /** Load-shape uplift on wholesale: 1.0 = flat base load; >1 for peaky loads. */
  loadShapeUplift: number;
}

export const DEFAULT_BENCHMARK_ASSUMPTIONS: RetailBenchmarkAssumptions = {
  retailMarginPerKwh: 0.012,
  environmentalPerKwh: 0.011,
  marketFeesPerKwh: 0.002,
  lossUplift: 1.05,
  loadShapeUplift: 1.1,
};

/** Build an indicative competitive retail energy rate ($/kWh) from a futures price ($/MWh). */
export function benchmarkRetailEnergyRate(
  futuresPerMwh: number,
  a: Partial<RetailBenchmarkAssumptions> = {},
): number {
  const x = { ...DEFAULT_BENCHMARK_ASSUMPTIONS, ...a };
  const wholesalePerKwh = (futuresPerMwh / 1000) * x.lossUplift * x.loadShapeUplift;
  return wholesalePerKwh + x.retailMarginPerKwh + x.environmentalPerKwh + x.marketFeesPerKwh;
}

export interface BenchmarkBand {
  low: number;
  mid: number;
  high: number;
}

/**
 * Forward prices move and a real tender depends on credit/term, so present the benchmark as
 * a BAND, not a point. `bandPct` is the ± uncertainty applied to the mid estimate.
 */
export function benchmarkRetailEnergyBand(
  futuresPerMwh: number,
  a: Partial<RetailBenchmarkAssumptions> = {},
  bandPct = 0.1,
): BenchmarkBand {
  const mid = benchmarkRetailEnergyRate(futuresPerMwh, a);
  return { low: mid * (1 - bandPct), mid, high: mid * (1 + bandPct) };
}

export interface RetailComparison {
  actualPerKwh: number;
  benchmarkPerKwh: number;
  /** actual − benchmark; positive means the client is paying above benchmark. */
  deltaPerKwh: number;
  /** Indicative annual re-tender opportunity, $. Zero if at/below benchmark. */
  annualOpportunity: number;
  aboveBenchmark: boolean;
}

/**
 * Compare a client's actual retail energy rate to the benchmark. The opportunity is
 * indicative only — a re-tender estimate, not a quote.
 */
export function compareRetailRate(
  actualPerKwh: number,
  benchmarkPerKwh: number,
  annualKwh: number,
): RetailComparison {
  const deltaPerKwh = actualPerKwh - benchmarkPerKwh;
  return {
    actualPerKwh,
    benchmarkPerKwh,
    deltaPerKwh,
    annualOpportunity: deltaPerKwh > 0 ? deltaPerKwh * annualKwh : 0,
    aboveBenchmark: deltaPerKwh > 0,
  };
}
