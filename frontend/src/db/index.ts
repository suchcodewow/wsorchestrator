import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// A single pooled client, reused across hot reloads in dev.
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Cloud SQL via the connector uses a unix socket; keep the pool modest
    // since Cloud Run scales horizontally.
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
// Exposed for the admin SQL console, which needs a dedicated connection to run
// a query inside its own READ ONLY transaction (see `@/lib/sql-console`).
export { pool, schema };
