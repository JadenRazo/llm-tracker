import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    // Generated output, not source. `.poller-build/index.js` is a 2.8 MB esbuild
    // bundle of the app plus pg/cheerio/drizzle; linting it buried the real
    // findings under ~10,000 warnings from third-party code.
    ignores: [".next/**", ".poller-build/**", "poller.zip", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
