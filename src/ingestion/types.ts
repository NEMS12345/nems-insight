import type { QualityFlag, ReadingUnit } from "@/core/types";

/**
 * A normalised reading produced by any ingestion parser, before it's matched to a metering
 * point. Every format adapter (NEM12, meter-profile, …) outputs this same shape, so the
 * rest of the system never needs to know which format the data arrived in.
 */
export interface ParsedReading {
  nmi: string;
  /** Meter serial, where the source identifies individual meters under an NMI. */
  meterSerial?: string;
  channel: string; // E1 (consumption), B1 (export), Q1 (reactive)
  intervalStart: string; // ISO 8601 with +10:00 offset (AEST)
  intervalLength: number; // minutes
  value: number;
  unit: ReadingUnit;
  quality: QualityFlag;
}

export interface ParseResult {
  readings: ParsedReading[];
  nmis: string[];
  errors: string[];
  warnings: string[];
}
