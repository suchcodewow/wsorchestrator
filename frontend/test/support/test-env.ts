/**
 * Points `@/db` at the scratch database. Import this first in any suite that
 * touches the database: `@/db` builds its pool from `DATABASE_URL` when it is
 * first imported, and tsx does not read `.env` (which names the real local
 * `workshops` database), so without this the pool would have no target at all.
 *
 * An explicit `DATABASE_URL` still wins — CI passes its own — and
 * `assertScratchDatabase` checks whichever one ends up in use.
 */

import { DEFAULT_TEST_DATABASE_URL } from "./db";

process.env.DATABASE_URL ||= DEFAULT_TEST_DATABASE_URL;
