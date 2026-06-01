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
];

export default eslintConfig;
