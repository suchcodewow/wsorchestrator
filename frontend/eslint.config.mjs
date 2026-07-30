import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Flat config — the only format ESLint 10 accepts, and the default for
 * `@next/eslint-plugin-next` since Next 16. `next lint` no longer exists, so
 * this is driven straight from the ESLint CLI via `npm run lint`.
 *
 * `core-web-vitals` promotes the LCP/CLS-affecting Next rules from warning to
 * error; `typescript` layers on typescript-eslint's recommended set.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Build output. `.next/**` also covers `.next/dev/**`, which `next dev`
    // writes to as of Next 16.
    ".next/**",
    "out/**",
    "build/**",
    // Generated: Next owns this one, and drizzle-kit owns the migrations.
    "next-env.d.ts",
    "drizzle/**",
  ]),
]);
