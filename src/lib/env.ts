// Environment-variable parsing and validation.
//
// All env access in this app should go through `env()` so missing/malformed values
// fail fast with a clear error at startup rather than surfacing deep in a poller.

import { z } from "zod";

// Treat empty strings as absent — .env files often declare keys with no value
// to document their existence, and we shouldn't trip validation on that.
const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  DATABASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  GITHUB_TOKEN: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  ADMIN_TOKEN: z.preprocess(emptyToUndef, z.string().min(16).optional()),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let _cached: Env | null = null;

export function env(): Env {
  if (_cached) return _cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Don't leak actual values; just flag which keys are broken.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${fields}`);
  }
  _cached = parsed.data;
  return _cached;
}
