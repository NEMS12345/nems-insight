import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TARIFF_VERSIONS } from "@/core/tariff";

// [v1.1] Drift lock: migration 0019 seeds network_tariff rows whose `rates` JSON must be
// EXACTLY the code registry's Tariff values (CLAUDE.md §5b — the code registry remains the
// seed source and golden fixture). If either side changes without the other, this fails.

const MIGRATION = join(__dirname, "../../supabase/migrations/0019_v11_monthly_loop.sql");

function seededRates(): Record<string, unknown> {
  const sql = readFileSync(MIGRATION, "utf8");
  // The seed block encodes each rate set as a single-line '{"code":...}'::jsonb literal.
  const matches = [...sql.matchAll(/'(\{"code":[\s\S]*?\})'::jsonb/g)];
  const out: Record<string, unknown> = {};
  for (const m of matches) {
    const obj = JSON.parse(m[1].replace(/''/g, "'"));
    out[(obj as { code: string }).code] = obj;
  }
  return out;
}

describe("network_tariff seed ↔ code registry drift lock", () => {
  const seeded = seededRates();

  it("seeds exactly the codes the registry holds", () => {
    expect(Object.keys(seeded).sort()).toEqual(Object.keys(TARIFF_VERSIONS).sort());
  });

  it.each(Object.keys(TARIFF_VERSIONS))(
    "migration JSON for %s deep-equals the current code-registry version",
    (code) => {
      // 0019 seeds the version current at the time it was written — the latest then. If a
      // NEWER version is later added to the registry, seed the new row via a new migration
      // and update this expectation deliberately, never by loosening the comparison.
      const versions = TARIFF_VERSIONS[code];
      const match = versions.find(
        (v) => v.effectiveFrom === (seeded[code] as { effectiveFrom?: string }).effectiveFrom,
      );
      expect(match, `no registry version matches seeded effectiveFrom for ${code}`).toBeTruthy();
      expect(seeded[code]).toEqual(JSON.parse(JSON.stringify(match)));
    },
  );
});
