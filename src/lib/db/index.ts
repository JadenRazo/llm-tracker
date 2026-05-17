// Database client — Drizzle over a pg Pool for connection pooling.
//
// The pool is created lazily so the module can be imported without DATABASE_URL
// set (e.g. during `next build`). Always call getDb() — do not cache the return
// value at module scope in other files.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

let _pool: Pool | null = null;
let _db: DrizzleClient | null = null;

function getPool(): Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return _pool;
}

export function getDb(): DrizzleClient {
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

/**
 * Best-effort DB access. Returns `null` if DATABASE_URL is missing or the pool can't
 * be created — callers should render a "no data yet" placeholder in that case.
 */
export function tryGetDb(): DrizzleClient | null {
  try {
    return getDb();
  } catch {
    return null;
  }
}

export { schema };
export type Database = ReturnType<typeof getDb>;
