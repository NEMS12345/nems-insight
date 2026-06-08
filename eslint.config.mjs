import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Architecture boundary: the calculation core (Layer 2) must stay PURE TypeScript.
  // It may not import framework, database, or other-layer code. This is what keeps the
  // money logic portable/testable and lets a self-serve tier bolt on later. See CLAUDE.md §3.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/data",
                "@/data/*",
                "@/ingestion",
                "@/ingestion/*",
                "@/app",
                "@/app/*",
                "@/components",
                "@/components/*",
                "next",
                "next/*",
                "react",
                "react-dom",
                "@supabase/*",
              ],
              message:
                "src/core must stay pure: no framework, database, or other-layer imports. See CLAUDE.md §3.",
            },
          ],
        },
      ],
    },
  },

  // Trust boundary: the SERVICE-ROLE Supabase client bypasses Row-Level Security, so it must
  // live ONLY in src/data and never be imported by another layer. src/core already forbids all
  // of @/data (purity rule above); this covers the remaining layers. The rule may sit dormant
  // until the `@/data/service-role` module exists. See CLAUDE.md §3.
  {
    files: [
      "src/ingestion/**/*.{ts,tsx}",
      "src/app/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/data/service-role", "@/data/service-role/*"],
              message:
                "The service-role Supabase client bypasses RLS — it may ONLY be imported inside src/data. See CLAUDE.md §3.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
