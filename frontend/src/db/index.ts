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

    // pg's default idle timeout is 10s, which is wrong for this workload.
    // Authoring is bursty — paste a screenshot, type for a minute, paste
    // another — so a 10s idle window drains the pool to empty between every
    // burst, and the next request pays a fresh dial through the Cloud SQL
    // connector. When that dial hangs it hangs for the connector's own 10s
    // timeout, which is exactly the 10.2s p95 that made pasting an image feel
    // broken. A minute keeps one connection alive across the pauses.
    idleTimeoutMillis: 60_000,

    // Cloud Run can idle a container's network without closing it. A TCP
    // keepalive means a connection the pool still believes in is either still
    // usable or already gone, rather than discovered dead mid-query.
    keepAlive: true,

    // Default is 0 — wait forever — which is how a bad dial becomes a 10s
    // request instead of a fast failure. Fail well inside the connector's
    // timeout so the error surfaces (and the caller can retry on a fresh
    // connection) rather than being sat on.
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
// Exposed for the admin SQL console, which needs a dedicated connection to run
// a query inside its own READ ONLY transaction (see `@/lib/sql-console`).
export { pool, schema };
