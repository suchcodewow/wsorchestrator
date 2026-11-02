/**
 * The studio's side of `mimir_studio_jobs`: it claims a queued row, keeps its
 * progress current, and ends it. Plain `pg`, as the runner does, rather than
 * the app's Drizzle setup; the table is the frontend's (`src/db/schema.ts`).
 */

import pg from "pg";
import { mapContentSchema, withVideos, type MapContent, type TranslatedLanguage, type VideoRow } from "../../../frontend/src/lib/mimir/map/schema";

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

type MapVideo = NonNullable<MapContent["concepts"][number]["video"]>;
export type NewVideo = { conceptId: string; video: Pick<MapVideo, "object" | "seconds" | "transcript">; feedbackIds: string[] };

/** The live version's structure and its concepts' videos, read as the app reads them (`lib/mimir/map/content.ts`). */
async function readLive(client: pg.PoolClient | pg.Pool): Promise<MapContent | null> {
  const { rows } = await client.query<{ content: unknown }>(`select content from mimir_map_versions order by version desc limit 1`);
  if (!rows[0]) return null;
  const videos = await client.query<VideoRow>(
    `select concept_id as "conceptId", language, object, seconds, transcript from mimir_concept_videos
      where concept_id in (select e.c->>'id' from jsonb_array_elements($1::jsonb->'concepts') as e(c))`,
    [JSON.stringify(rows[0].content)],
  );
  const parsed = mapContentSchema.safeParse(withVideos(rows[0].content, videos.rows));
  return parsed.success ? parsed.data : null;
}

/**
 * Puts a regenerated video on the live map, in one transaction: the concept's
 * video rows are locked so a translation finishing meanwhile cannot land on
 * the old one, and the comments the video took in become 'applied'. Any
 * translations come off with the old video, so nobody is shown a version that
 * no longer matches. The map's structure is not touched, so an edit made
 * meanwhile stands. Returns the object the concept had before, or throws when
 * the concept is no longer on the map or the job has been given up on.
 */
export async function publishVideo(jobId: string, done: NewVideo): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const map = await readLive(client);
    if (!map) throw new Error("The live map is missing or no longer reads, so the video could not be added to it.");
    const concept = map.concepts.find((c) => c.id === done.conceptId);
    if (!concept) throw new Error(`The concept ${done.conceptId} is no longer on the map.`);
    const before = await client.query<{ object: string }>(
      `select object from mimir_concept_videos where concept_id = $1 and language = 'en' for update`,
      [done.conceptId],
    );
    const was = before.rows[0]?.object ?? null;
    await client.query(`delete from mimir_concept_videos where concept_id = $1`, [done.conceptId]);
    await client.query(
      `insert into mimir_concept_videos (concept_id, language, object, seconds, transcript) values ($1, 'en', $2, $3, $4)`,
      [done.conceptId, done.video.object, done.video.seconds, done.video.transcript],
    );
    if (done.feedbackIds.length) {
      await client.query(
        `update video_feedback set status = 'applied'
          where id = any($1::uuid[]) and status = 'accepted' and video_kind = 'mimir_concept' and concept_id = $2`,
        [done.feedbackIds, done.conceptId],
      );
    }
    const running = await client.query(`update mimir_studio_jobs set updated_at = now() where id = $1 and status = 'running'`, [jobId]);
    if (running.rowCount === 0) throw new Error("The job was given up on before the video was finished; the map is left as it was.");
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

/**
 * Adds a translation to the concept's video, as long as that is still the
 * video it was translated from: the English row is locked for the same reason.
 */
export async function addTranslation(conceptId: string, from: string, language: TranslatedLanguage, file: Pick<MapVideo, "object" | "seconds" | "transcript">): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const english = await client.query<{ object: string }>(
      `select object from mimir_concept_videos where concept_id = $1 and language = 'en' for update`,
      [conceptId],
    );
    if (english.rows[0]?.object !== from) throw new Error(`The video for ${conceptId} changed while it was being translated.`);
    const map = await readLive(client);
    const concept = map?.concepts.find((c) => c.id === conceptId);
    if (!concept) throw new Error(`The concept ${conceptId} is no longer on the map.`);
    await client.query(
      `insert into mimir_concept_videos (concept_id, language, object, seconds, transcript) values ($1, $2, $3, $4, $5)
       on conflict (concept_id, language) do update set object = excluded.object, seconds = excluded.seconds,
         transcript = excluded.transcript, created_at = now()`,
      [conceptId, language, file.object, file.seconds, file.transcript],
    );
    await client.query("commit");
    await recordAudit("studio.video.translate", `Translated the video for ${concept.name} into ${language}.`, conceptId, concept.name, "succeeded", {
      object: file.object,
      from,
      language,
      seconds: file.seconds,
    });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** A video job has done all it set out to. */
export async function endVideoJob(id: string, result: unknown): Promise<void> {
  await pool.query(
    `update mimir_studio_jobs set status = 'succeeded', result = $2::jsonb, progress = null, finished_at = now(), updated_at = now()
      where id = $1 and status = 'running'`,
    [id, JSON.stringify(result)],
  );
}

/** The live map, or null when none has been imported or it no longer reads. */
export async function liveMap(): Promise<MapContent | null> {
  return readLive(pool);
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
