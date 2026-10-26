/**
 * Smiley and confused ratings on videos, from the buttons over every player:
 * which video it was, checked against what the caller may watch, and the
 * feedback read back a page at a time.
 *
 * A video is named by its kind and id: a Mimir concept's id, which anyone
 * signed in may watch, or a recording stream's id, which only those who may
 * watch recordings may.
 */

import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  mimirMap,
  recordingTracks,
  users,
  videoFeedback,
  type VideoFeedbackKind,
  type VideoFeedbackRating,
  type VideoFeedbackStatus,
} from "@/db/schema";
import type { VideoFeedbackSort, VideoFeedbackSummarySort } from "@/lib/list-specs";
import { getMap } from "@/lib/mimir/map/content";
import { MAP_ID } from "@/lib/mimir/map/schema";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";
import { canUseTraining, type Access } from "@/lib/roles";
import { isUuid } from "@/lib/utils";

export type VideoRef = { kind: VideoFeedbackKind; id: string };

/** A video found and the caller allowed to rate it, with the name its feedback is filed under. */
type FoundVideo = { kind: VideoFeedbackKind; conceptId: string | null; recordingTrackId: string | null; label: string };

/** The video `ref` names, if there is one; "forbidden" if the caller may not watch it. */
export async function findVideo(access: Access, ref: VideoRef): Promise<FoundVideo | "forbidden" | null> {
  if (ref.kind === "mimir_concept") {
    const concept = (await getMap())?.content.concepts.find((c) => c.id === ref.id);
    return concept?.video ? { kind: ref.kind, conceptId: concept.id, recordingTrackId: null, label: concept.name } : null;
  }
  if (!canUseTraining(access)) return "forbidden";
  if (!isUuid(ref.id)) return null;
  const [track] = await db
    .select({ id: recordingTracks.id, kind: recordingTracks.kind, contributor: recordingTracks.contributor })
    .from(recordingTracks)
    .where(eq(recordingTracks.id, ref.id));
  if (!track) return null;
  const label = `${track.contributor || "No name given"} — ${track.kind === "camera" ? "camera" : "screen"}`;
  return { kind: ref.kind, conceptId: null, recordingTrackId: track.id, label };
}

export type NewVideoFeedback = { rating: VideoFeedbackRating; position: number; comment: string | null };

/** One row: every press of a face, or save of a comment, is its own. */
export async function recordVideoFeedback(userId: string, video: FoundVideo, input: NewVideoFeedback) {
  const [row] = await db
    .insert(videoFeedback)
    .values({
      userId,
      videoKind: video.kind,
      conceptId: video.conceptId,
      recordingTrackId: video.recordingTrackId,
      videoLabel: video.label,
      rating: input.rating,
      positionSeconds: input.position,
      comment: input.comment,
    })
    .returning();
  return toRow({ ...row!, userName: null, userEmail: null });
}

export type VideoFeedbackRow = {
  id: string;
  rating: VideoFeedbackRating;
  video: { kind: VideoFeedbackKind; id: string; label: string };
  positionSeconds: number;
  comment: string | null;
  status: VideoFeedbackStatus;
  user: { id: string; name: string | null; email: string | null } | null;
  createdAt: string;
};

type Selected = typeof videoFeedback.$inferSelect & { userName: string | null; userEmail: string | null };

function toRow(r: Selected): VideoFeedbackRow {
  return {
    id: r.id,
    rating: r.rating,
    video: { kind: r.videoKind, id: (r.conceptId ?? r.recordingTrackId)!, label: r.videoLabel },
    positionSeconds: r.positionSeconds,
    comment: r.comment,
    status: r.status,
    user: r.userId ? { id: r.userId, name: r.userName, email: r.userEmail } : null,
    createdAt: r.createdAt.toISOString(),
  };
}

const SORT_COLUMNS = {
  createdAt: videoFeedback.createdAt,
  video: sql`lower(${videoFeedback.videoLabel})`,
  user: sql`lower(coalesce(${blankAsNull(users.name)}, ${users.email}))`,
  rating: videoFeedback.rating,
  position: videoFeedback.positionSeconds,
};

/** `video` is one video's id, and means something only with the `kind` it is the id of. */
export type VideoFeedbackFilter = { kind?: VideoFeedbackKind; rating?: VideoFeedbackRating; video?: string };

function videoIs(filter: VideoFeedbackFilter) {
  if (!filter.kind || !filter.video) return undefined;
  if (filter.kind === "mimir_concept") return eq(videoFeedback.conceptId, filter.video);
  return isUuid(filter.video) ? eq(videoFeedback.recordingTrackId, filter.video) : sql`false`;
}

/** Feedback a page at a time, the newest first; searched by video, comment, and who gave it. */
export async function listVideoFeedback(
  query: ListQuery<VideoFeedbackSort>,
  filter: VideoFeedbackFilter = {},
): Promise<Page<VideoFeedbackRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: videoFeedback.id,
      userId: videoFeedback.userId,
      videoKind: videoFeedback.videoKind,
      conceptId: videoFeedback.conceptId,
      recordingTrackId: videoFeedback.recordingTrackId,
      videoLabel: videoFeedback.videoLabel,
      rating: videoFeedback.rating,
      positionSeconds: videoFeedback.positionSeconds,
      comment: videoFeedback.comment,
      status: videoFeedback.status,
      createdAt: videoFeedback.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(videoFeedback)
    .leftJoin(users, eq(users.id, videoFeedback.userId))
    .where(
      and(
        filter.kind ? eq(videoFeedback.videoKind, filter.kind) : undefined,
        filter.rating ? eq(videoFeedback.rating, filter.rating) : undefined,
        videoIs(filter),
        searchAny(query.q, [videoFeedback.videoLabel, videoFeedback.comment, users.name, users.email]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`${videoFeedback.createdAt} desc`, videoFeedback.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows.map(toRow), query.page);
}

/**
 * One Mimir concept and how its video has been rated. A comment is a rating
 * that came with words. A concept with no video yet has no ratings; one with
 * ratings that has since left the map is still listed, with `inMap` false.
 */
export type VideoFeedbackSummaryRow = {
  conceptId: string;
  label: string;
  inMap: boolean;
  hasVideo: boolean;
  up: number;
  upComments: number;
  down: number;
  downComments: number;
  /** Comments an administrator has accepted and no regeneration has taken in yet. */
  accepted: number;
};

const COUNTS = {
  up: sql<number>`count(*) filter (where ${videoFeedback.rating} = 'up')::int`,
  upComments: sql<number>`count(*) filter (where ${videoFeedback.rating} = 'up' and ${isNotNull(videoFeedback.comment)})::int`,
  down: sql<number>`count(*) filter (where ${videoFeedback.rating} = 'down')::int`,
  downComments: sql<number>`count(*) filter (where ${videoFeedback.rating} = 'down' and ${isNotNull(videoFeedback.comment)})::int`,
  accepted: sql<number>`count(*) filter (where ${videoFeedback.status} = 'accepted')::int`,
};

const SUMMARY_SORT_COLUMNS = {
  video: sql`lower(r.label)`,
  up: sql`r.up`,
  upComments: sql`r."upComments"`,
  down: sql`r.down`,
  downComments: sql`r."downComments"`,
};

/** Every concept on the Mimir map, and any other with feedback, a page at a time, with its counts; searched by the concept's name. */
export async function listVideoFeedbackSummary(
  query: ListQuery<VideoFeedbackSummarySort>,
): Promise<Page<VideoFeedbackSummaryRow>> {
  const { limit, offset } = pageWindow(query.page);
  const where = and(sql`true`, searchAny(query.q, [sql`r.label`]));
  const order = orderFor(SUMMARY_SORT_COLUMNS[query.sort], query.dir, sql`r."conceptId"`);
  const { rows } = await db.execute<VideoFeedbackSummaryRow>(sql`
    with concepts as (
      select e.c->>'id' as concept_id, e.c->>'name' as label, jsonb_typeof(e.c->'video') = 'object' as has_video
        from ${mimirMap}, jsonb_array_elements(${mimirMap.content}->'concepts') as e(c)
       where ${mimirMap.id} = ${MAP_ID}
    ), counts as (
      select ${videoFeedback.conceptId} as concept_id,
             (array_agg(${videoFeedback.videoLabel} order by ${videoFeedback.createdAt} desc))[1] as label,
             ${COUNTS.up} as up, ${COUNTS.upComments} as up_comments,
             ${COUNTS.down} as down, ${COUNTS.downComments} as down_comments,
             ${COUNTS.accepted} as accepted
        from ${videoFeedback}
       where ${videoFeedback.videoKind} = 'mimir_concept'
       group by ${videoFeedback.conceptId}
    ), r as (
      select coalesce(c.concept_id, f.concept_id) as "conceptId",
             coalesce(c.label, f.label) as label,
             c.concept_id is not null as "inMap",
             coalesce(c.has_video, false) as "hasVideo",
             coalesce(f.up, 0) as up, coalesce(f.up_comments, 0) as "upComments",
             coalesce(f.down, 0) as down, coalesce(f.down_comments, 0) as "downComments",
             coalesce(f.accepted, 0) as accepted
        from concepts c full outer join counts f on f.concept_id = c.concept_id
    )
    select r.* from r
     where ${where}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(rows, query.page);
}

export type VideoFeedbackEdit = { comment?: string; status?: VideoFeedbackStatus };

/**
 * An administrator's edit to a comment's words or its status. Only a row that
 * has a comment can be changed: "not_found" if there is no such row,
 * "no_comment" if it is a bare rating. Returns the row as it was too, for the audit.
 */
export async function updateVideoFeedback(
  id: string,
  edit: VideoFeedbackEdit,
): Promise<{ before: VideoFeedbackRow; after: VideoFeedbackRow } | "not_found" | "no_comment"> {
  if (!isUuid(id)) return "not_found";
  const read = async () => {
    const [row] = await db
      .select({ f: videoFeedback, userName: users.name, userEmail: users.email })
      .from(videoFeedback)
      .leftJoin(users, eq(users.id, videoFeedback.userId))
      .where(eq(videoFeedback.id, id));
    return row ? toRow({ ...row.f, userName: row.userName, userEmail: row.userEmail }) : null;
  };
  const before = await read();
  if (!before) return "not_found";
  if (before.comment === null) return "no_comment";
  await db
    .update(videoFeedback)
    .set({
      ...(edit.comment !== undefined ? { comment: edit.comment } : {}),
      ...(edit.status ? { status: edit.status } : {}),
    })
    .where(eq(videoFeedback.id, id));
  return { before, after: (await read())! };
}

/**
 * A concept's accepted comments, in the order they come in the video, for a
 * regeneration to take in: at most `limit`, the earliest kept.
 */
export async function acceptedComments(conceptId: string, limit: number) {
  return db
    .select({ id: videoFeedback.id, position: videoFeedback.positionSeconds, rating: videoFeedback.rating, comment: videoFeedback.comment })
    .from(videoFeedback)
    .where(
      and(
        eq(videoFeedback.videoKind, "mimir_concept"),
        eq(videoFeedback.conceptId, conceptId),
        eq(videoFeedback.status, "accepted"),
        isNotNull(videoFeedback.comment),
      ),
    )
    .orderBy(videoFeedback.positionSeconds, videoFeedback.createdAt)
    .limit(limit);
}
