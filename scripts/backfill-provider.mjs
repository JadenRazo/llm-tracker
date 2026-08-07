// Phase 2.0 backfill: every pre-multi-LLM row is Claude. Sets
// `provider = 'claude'` where it is still NULL on the three tables that gained
// the column in migration 0001 (cli_reference, events, models).
//
// Run:  npm run db:backfill-provider
// (which is `node --env-file=.env scripts/backfill-provider.mjs`)
//
// Idempotent: the `WHERE provider IS NULL` guard means a second run touches
// zero rows. Forward-only & backward-compatible — the column stays nullable;
// tightening to NOT NULL DEFAULT happens in a later phase, not here.

import { Pool } from "pg";

const TABLES = ["cli_reference", "events", "models"];
const DEFAULT_PROVIDER = "claude";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a local Postgres, then re-run `npm run db:backfill-provider`.",
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error(
      `Could not connect to Postgres at the configured DATABASE_URL: ${
        err instanceof Error ? err.message : String(err)
      }\nStart your local Postgres (or fix DATABASE_URL in .env) and re-run \`npm run db:backfill-provider\`.`,
    );
    await pool.end();
    process.exit(1);
  }

  let total = 0;
  for (const table of TABLES) {
    const result = await pool.query(
      `UPDATE "${table}" SET provider = $1 WHERE provider IS NULL`,
      [DEFAULT_PROVIDER],
    );
    total += result.rowCount;
    console.log(`${table}: ${result.rowCount} rows set to provider='${DEFAULT_PROVIDER}'.`);
  }

  await pool.end();
  console.log(`provider backfill complete — ${total} rows updated across ${TABLES.length} tables.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
