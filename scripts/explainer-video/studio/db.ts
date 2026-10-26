/**
 * The studio's side of `mimir_studio_jobs`: it claims a queued row, keeps its
 * progress current, and ends it. Plain `pg`, as the runner does, rather than
 * the app's Drizzle setup; the table is the frontend's (`src/db/schema.ts`).
 */

import pg from "pg";
import { mapContentSchema, MAP_ID, type MapContent } from "../../../frontend/src/lib/mimir/map/schema";

/** `SYSTEM_ACTORS.studio` in the frontend's `lib/audit.ts`; the two agree. */
export const AUDIT_ACTOR = "Mimir Studio";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

export type JobRow = {
  id: string;
  kind: "deck" | "video";
  status: string;
  concept_id: string | null;
  label: string;
  input: Record<string, unknown>;
};

/** Moves a queued job to running; null when it is not queued (another execution has it, or it was given up on). */
export async function claimJob(id: string): Promise<JobRow | null> {
  const { rows } = await pool.query<JobRow>(
    `update mimir_studio_jobs
        set status = 'running', started_at = now(), updated_at = now(), error = null, execution = $2,
            progress = 'Starting.'
      where id = $1 and status = 'queued'
      returning id, kind, status, concept_id, label, input`,
    [id, process.env.CLOUD_RUN_EXECUTION ?? `local:${process.pid}`],
  );
  return rows[0] ?? null;
}

/** What the job is doing now, for the page to show. Also tells the app it is still alive. */
export async function setProgress(id: string, progress: string): Promise<void> {
  console.log(`progress: ${progress}`);
  await pool.query(`update mimir_studio_jobs set progress = $2, updated_at = now() where id = $1 and status = 'running'`, [id, progress.slice(0, 500)]);
}

/** Touches the row so a long render is not mistaken for a dead job. */
export async function heartbeat(id: string): Promise<void> {
  await pool.query(`update mimir_studio_jobs set updated_at = now() where id = $1 and status = 'running'`, [id]);
}

export async function failJob(id: string, error: string): Promise<void> {
  await pool.query(
    `update mimir_studio_jobs set status = 'failed', error = $2, finished_at = now(), updated_at = now()
      where id = $1 and status in ('queued', 'running')`,
    [id, error.slice(0, 4000)],
  );
}

/** A deck's draft is ready for someone to look over and publish. */
export async function deckReady(id: string, result: unknown): Promise<void> {
  await pool.query(
    `update mimir_studio_jobs set status = 'ready', result = $2::jsonb, progress = null, finished_at = now(), updated_at = now()
      where id = $1 and status = 'running'`,
    [id, JSON.stringify(result)],
  );
}

export type FinishedVideo = { conceptId: string; video: NonNullable<MapContent["concepts"][number]["video"]>; feedbackIds: string[]; result: unknown };

/**
 * Puts a regenerated video on the live map and ends the job, in one
 * transaction: the map row is locked so a deck published meanwhile is not
 * overwritten, the comments the video took in become 'applied', and the job
 * succeeds. Returns the object the concept had before, or throws when the
 * concept is no longer on the map.
 */
export async function finishVideo(jobId: string, done: FinishedVideo): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ content: unknown }>(`select content from mimir_map where id = $1 for update`, [MAP_ID]);
    const parsed = rows[0] ? mapContentSchema.safeParse(rows[0].content) : null;
    if (!parsed?.success) throw new Error("The live map is missing or no longer reads, so the video could not be added to it.");
    const map = parsed.data;
    const concept = map.concepts.find((c) => c.id === done.conceptId);
    if (!concept) throw new Error(`The concept ${done.conceptId} is no longer on the map.`);
    const was = concept.video?.object ?? null;
    const content = mapContentSchema.parse({ ...map, concepts: map.concepts.map((c) => (c.id === done.conceptId ? { ...c, video: done.video } : c)) });
    await client.query(`update mimir_map set content = $2::jsonb where id = $1`, [MAP_ID, JSON.stringify(content)]);
    if (done.feedbackIds.length) {
      await client.query(
        `update video_feedback set status = 'applied'
          where id = any($1::uuid[]) and status = 'accepted' and video_kind = 'mimir_concept' and concept_id = $2`,
        [done.feedbackIds, done.conceptId],
      );
    }
    const ended = await client.query(
      `update mimir_studio_jobs set status = 'succeeded', result = $2::jsonb, progress = null, finished_at = now(), updated_at = now()
        where id = $1 and status = 'running'`,
      [jobId, JSON.stringify(done.result)],
    );
    if (ended.rowCount === 0) throw new Error("The job was given up on before the video was finished; the map is left as it was.");
    await client.query("commit");
    // After the commit: a failed audit insert inside the transaction would undo the video with it.
    await recordAudit(
      "studio.video.finish",
      `Made a new video for ${concept.name}.`,
      done.conceptId,
      concept.name,
      "succeeded",
      { jobId, object: done.video.object, previous: was, seconds: done.video.seconds, applied: done.feedbackIds.length },
    );
    return was;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The live map, or null when none has been imported or it no longer reads. */
export async function liveMap(): Promise<MapContent | null> {
  const { rows } = await pool.query<{ content: unknown }>(`select content from mimir_map where id = $1`, [MAP_ID]);
  const parsed = rows[0] ? mapContentSchema.safeParse(rows[0].content) : null;
  return parsed?.success ? parsed.data : null;
}

export async function recordAudit(
  action: string,
  summary: string,
  target: string,
  targetLabel: string,
  outcome: "succeeded" | "failed",
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await pool.query(
      `insert into audit_events (actor_name, via, action, summary, target, target_label, outcome, detail)
       values ($1, 'system', $2, $3, $4, $5, $6::audit_outcome, $7::jsonb)`,
      [AUDIT_ACTOR, action, summary, target, targetLabel, outcome, JSON.stringify(detail)],
    );
  } catch (err) {
    console.error(`audit: could not record ${action} for ${target}:`, err);
  }
}
