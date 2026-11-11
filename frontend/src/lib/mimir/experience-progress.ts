/**
 * Finished runs of Coach Canary's hands-on experiences, and the reporting
 * page's view of everyone: their videos watched to the end, the concepts the
 * coach has marked them as knowing, and how far they are with each
 * experience. What counts as a run, and what it may report, is in
 * `experiences.ts`.
 */

import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  mimirConceptProgress,
  mimirExperienceProgress,
  mimirSlideReviewRuns,
  users,
  type MimirExperienceProgress,
  type MimirSlideReviewRun,
} from "@/db/schema";
import type { ExperienceReportSort } from "@/lib/list-specs";
import { RECENT_SLIDES, type ExperienceRun } from "@/lib/mimir/experiences";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

type WholeRun = Extract<ExperienceRun, { experience: "developer" | "security" }>;
type SlideRun = Extract<ExperienceRun, { experience: "slide-review" }>;

/** One more finished run of an experience kept whole: an attempt added, the best score kept, the first completion left as it was. */
export async function recordExperienceRun(userId: string, run: WholeRun): Promise<MimirExperienceProgress> {
  const t = mimirExperienceProgress;
  const now = new Date();
  const [row] = await db
    .insert(t)
    .values({ userId, experience: run.experience, attempts: 1, bestScore: run.score, firstCompletedAt: now, lastCompletedAt: now })
    .onConflictDoUpdate({
      target: [t.userId, t.experience],
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

/** One finished slide of the slide review. */
export async function recordSlideRun(userId: string, run: SlideRun): Promise<MimirSlideReviewRun> {
  const [row] = await db
    .insert(mimirSlideReviewRuns)
    .values({
      userId,
      seed: run.seed,
      theme: run.theme,
      found: run.found,
      total: run.total,
      wrongClicks: run.wrongClicks,
      score: run.score,
    })
    .returning();
  return row!;
}

/** This person's experiences kept whole, and their latest slides of the slide review, newest first. */
export async function myExperienceProgress(
  userId: string,
): Promise<{ progress: MimirExperienceProgress[]; slides: MimirSlideReviewRun[] }> {
  const [progress, slides] = await Promise.all([
    db.select().from(mimirExperienceProgress).where(eq(mimirExperienceProgress.userId, userId)).orderBy(mimirExperienceProgress.experience),
    db
      .select()
      .from(mimirSlideReviewRuns)
      .where(eq(mimirSlideReviewRuns.userId, userId))
      .orderBy(desc(mimirSlideReviewRuns.createdAt))
      .limit(PAGE_SIZE),
  ]);
  return { progress, slides };
}

export type RecentSlide = { seed: number; theme: string; found: number; total: number; wrongClicks: number; score: number; at: string };

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
  /** How many slides of the slide review they have finished. */
  slidesDone: number;
  /** The points of all those slides together. */
  slidesScore: number;
  /** The mistakes they found on them, out of how many there were. */
  slidesFound: number;
  slidesTotal: number;
  /** Their latest slides, newest first, up to `RECENT_SLIDES`. */
  recentSlides: RecentSlide[];
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
  const sr = mimirSlideReviewRuns;
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
             max(${ep.bestScore}) filter (where ${ep.experience} = 'security') as security_best
        from ${ep}
       group by ${ep.userId}
    ), slides as (
      select ${sr.userId} as user_id,
             count(*)::int as done,
             sum(${sr.score})::int as score,
             sum(${sr.found})::int as found,
             sum(${sr.total})::int as total
        from ${sr}
       group by ${sr.userId}
    ), r as (
      select u.id as "userId", u.name, u.email,
             coalesce(c.videos, 0) as videos, coalesce(c.mastered, 0) as mastered,
             e.developer_completed_at as "developerCompletedAt",
             coalesce(e.security_attempts, 0) as "securityAttempts", e.security_best as "securityBest",
             coalesce(s.done, 0) as "slidesDone", coalesce(s.score, 0) as "slidesScore",
             coalesce(s.found, 0) as "slidesFound", coalesce(s.total, 0) as "slidesTotal"
        from ${users} u
        left join concepts c on c.user_id = u.id
        left join runs e on e.user_id = u.id
        left join slides s on s.user_id = u.id
    )
    select r.*,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'seed', x.seed, 'theme', x.theme, 'found', x.found, 'total', x.total,
                      'wrongClicks', x.wrong_clicks, 'score', x.score, 'at', x.created_at
                    ) order by x.created_at desc)
               from (select * from ${sr} where ${sr.userId} = r."userId" order by ${sr.createdAt} desc limit ${RECENT_SLIDES}) x
           ), '[]'::jsonb) as "recentSlides"
      from r
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
