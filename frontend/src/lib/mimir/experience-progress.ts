/**
 * Finished runs of Coach Canary's hands-on experiences, and the reporting
 * page's view of everyone: their videos watched to the end, the concepts the
 * coach has marked them as knowing, and how far they are with each
 * experience. What counts as a run, and what it may report, is in
 * `experiences.ts`.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mimirConceptProgress, mimirExperienceProgress, users, type MimirExperienceProgress } from "@/db/schema";
import type { ExperienceReportSort } from "@/lib/list-specs";
import type { ExperienceRun } from "@/lib/mimir/experiences";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

/** One more finished run: an attempt added, the best score kept, the first completion left as it was. */
export async function recordExperienceRun(userId: string, run: ExperienceRun): Promise<MimirExperienceProgress> {
  const t = mimirExperienceProgress;
  const now = new Date();
  const [row] = await db
    .insert(t)
    .values({ userId, experience: run.experience, part: run.part, attempts: 1, bestScore: run.score, firstCompletedAt: now, lastCompletedAt: now })
    .onConflictDoUpdate({
      target: [t.userId, t.experience, t.part],
      set: {
        attempts: sql`${t.attempts} + 1`,
        // greatest() skips nulls, so a run without a score never wipes one.
        bestScore: sql`greatest(${t.bestScore}, excluded.best_score)`,
        lastCompletedAt: now,
      },
    })
    .returning();
  return row!;
}

/** This person's rows: one for each experience they have finished, and one for each slide of the slide review. */
export async function myExperienceProgress(userId: string): Promise<MimirExperienceProgress[]> {
  return db
    .select()
    .from(mimirExperienceProgress)
    .where(eq(mimirExperienceProgress.userId, userId))
    .orderBy(mimirExperienceProgress.experience, mimirExperienceProgress.part);
}

export type SlideStanding = { slide: string; attempts: number; bestScore: number | null };

export type ExperienceReportRow = {
  userId: string;
  name: string | null;
  email: string | null;
  /** Concept videos in the library watched to the end. */
  videos: number;
  /** Concepts the coach, in chat, has marked them as knowing. */
  mastered: number;
  developerCompletedAt: string | null;
  securityAttempts: number;
  securityBest: number | null;
  /** How many slides of the slide review they have finished at least once. */
  slidesDone: number;
  /** The sum of their best score on each slide finished. */
  slidesBest: number | null;
  /** Each finished slide, by its id. */
  slides: SlideStanding[];
};

const REPORT_SORT_COLUMNS: Record<ExperienceReportSort, ReturnType<typeof sql>> = {
  user: sql`lower(coalesce(nullif(r.name, ''), r.email))`,
  videos: sql`r.videos`,
  mastered: sql`r.mastered`,
  developer: sql`r."developerCompletedAt"`,
  security: sql`r."securityBest"`,
  slides: sql`r."slidesDone"`,
};

/** Everyone with an account, a page at a time, searched by name or email. */
export async function listExperienceReport(query: ListQuery<ExperienceReportSort>): Promise<Page<ExperienceReportRow>> {
  const { limit, offset } = pageWindow(query.page);
  const cp = mimirConceptProgress;
  const ep = mimirExperienceProgress;
  const where = searchAny(query.q, [sql`r.name`, sql`r.email`]) ?? sql`true`;
  const order = orderFor(REPORT_SORT_COLUMNS[query.sort], query.dir, sql`r."userId"`);
  const { rows } = await db.execute<ExperienceReportRow>(sql`
    with concepts as (
      select ${cp.userId} as user_id,
             count(*) filter (where ${cp.videoCompletedAt} is not null)::int as videos,
             count(*) filter (where ${cp.masteredAt} is not null)::int as mastered
        from ${cp}
       group by ${cp.userId}
    ), runs as (
      select ${ep.userId} as user_id,
             min(${ep.firstCompletedAt}) filter (where ${ep.experience} = 'developer') as developer_completed_at,
             coalesce(sum(${ep.attempts}) filter (where ${ep.experience} = 'security'), 0)::int as security_attempts,
             max(${ep.bestScore}) filter (where ${ep.experience} = 'security') as security_best,
             count(*) filter (where ${ep.experience} = 'slide-review')::int as slides_done,
             sum(${ep.bestScore}) filter (where ${ep.experience} = 'slide-review')::int as slides_best,
             coalesce(
               jsonb_agg(jsonb_build_object('slide', ${ep.part}, 'attempts', ${ep.attempts}, 'bestScore', ${ep.bestScore}))
                 filter (where ${ep.experience} = 'slide-review'),
               '[]'::jsonb
             ) as slides
        from ${ep}
       group by ${ep.userId}
    ), r as (
      select u.id as "userId", u.name, u.email,
             coalesce(c.videos, 0) as videos, coalesce(c.mastered, 0) as mastered,
             e.developer_completed_at as "developerCompletedAt",
             coalesce(e.security_attempts, 0) as "securityAttempts", e.security_best as "securityBest",
             coalesce(e.slides_done, 0) as "slidesDone", e.slides_best as "slidesBest",
             coalesce(e.slides, '[]'::jsonb) as slides
        from ${users} u
        left join concepts c on c.user_id = u.id
        left join runs e on e.user_id = u.id
    )
    select r.* from r
     where ${where}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(
    rows.map((r) => ({
      ...r,
      developerCompletedAt: r.developerCompletedAt ? new Date(r.developerCompletedAt).toISOString() : null,
    })),
    query.page,
  );
}
