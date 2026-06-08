// Registry of network tariff schedules in the general schema. Adding a DNSP tariff is a data
// edit here, never an engine change. Energex is POPULATED; the others are STRUCTURE-ONLY
// fixtures with placeholder figures (see containsPlaceholders / the per-rate TODOs).

import type { NetworkTariffSchema } from "@/core/tariff/schema";
import { ENERGEX_7200_SCHEMA, ENERGEX_7400_SCHEMA } from "@/core/tariff/schema/schedules/energex";
import { AUSGRID_LV_DEMAND_SCHEMA } from "@/core/tariff/schema/schedules/ausgrid";
import { SAPN_BUSINESS_TOU_SCHEMA } from "@/core/tariff/schema/schedules/sapower";

export {
  ENERGEX_7200_SCHEMA,
  ENERGEX_7400_SCHEMA,
  AUSGRID_LV_DEMAND_SCHEMA,
  SAPN_BUSINESS_TOU_SCHEMA,
};

export const TARIFF_SCHEDULES: Record<string, NetworkTariffSchema> = {
  [ENERGEX_7200_SCHEMA.code]: ENERGEX_7200_SCHEMA,
  [ENERGEX_7400_SCHEMA.code]: ENERGEX_7400_SCHEMA,
  [AUSGRID_LV_DEMAND_SCHEMA.code]: AUSGRID_LV_DEMAND_SCHEMA,
  [SAPN_BUSINESS_TOU_SCHEMA.code]: SAPN_BUSINESS_TOU_SCHEMA,
};

export function getTariffSchedule(code: string): NetworkTariffSchema | undefined {
  return TARIFF_SCHEDULES[code];
}
