/**
 * Which Iris questions are approved. A decision belongs to the version it was
 * made on, so a reworded question goes back to draft by itself; a question
 * nobody has reviewed is a draft. Only approved questions are served live.
 */

import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { irisItemReviews, users, type IrisReviewStatus } from "@/db/schema";
import { ENGINE, type Form, type IrisItem } from "@/lib/iris/engine";
import { IRIS_ITEMS } from "@/lib/iris/items";
import { SUBJECT_KEYS, type SubjectKey } from "@/lib/iris/subjects";

export type Review = {
  status: IrisReviewStatus;
  note: string;
  reviewer: string | null;
  updatedAt: Date | null;
};

const DRAFT: Review = { status: "draft", note: "", reviewer: null, updatedAt: null };

export const ITEMS_BY_ID = new Map(IRIS_ITEMS.map((i) => [i.id, i]));

/** The questions one subject has on one form: at most 38, so one query reads all their reviews. */
export const itemsOf = (subject: SubjectKey, form: Form) =>
  IRIS_ITEMS.filter((i) => i.subject === subject && i.form === form);

/** The current review of each of `items`, by id. */
export async function reviewsOf(items: readonly IrisItem[]): Promise<Map<string, Review>> {
  const out = new Map<string, Review>(items.map((i) => [i.id, DRAFT]));
  if (items.length === 0) return out;
  const rows = await db
    .select({
      itemId: irisItemReviews.itemId,
      itemVersion: irisItemReviews.itemVersion,
      status: irisItemReviews.status,
      note: irisItemReviews.note,
      reviewer: sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`,
      updatedAt: irisItemReviews.updatedAt,
    })
    .from(irisItemReviews)
    .leftJoin(users, eq(users.id, irisItemReviews.reviewerId))
    .where(inArray(irisItemReviews.itemId, items.map((i) => i.id)));
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const r of rows) {
    if (byId.get(r.itemId)?.version !== r.itemVersion) continue;
    out.set(r.itemId, {
      status: r.status as IrisReviewStatus,
      note: r.note,
      reviewer: r.reviewer,
      updatedAt: r.updatedAt,
    });
  }
  return out;
}

/** What a sitting draws from: approved questions live, anything not rejected in a preview. */
export async function poolFor(subject: SubjectKey, form: Form, mode: "live" | "preview"): Promise<IrisItem[]> {
  const items = itemsOf(subject, form);
  const reviews = await reviewsOf(items);
  return items.filter((i) => {
    const status = reviews.get(i.id)!.status;
    return mode === "live" ? status === "approved" : status !== "rejected";
  });
}

/** How many approved questions each subject has on `form`, from one query of at most eight rows. */
export async function approvedCounts(form: Form): Promise<Record<SubjectKey, number>> {
  const counts = Object.fromEntries(SUBJECT_KEYS.map((k) => [k, 0])) as Record<SubjectKey, number>;
  const items = IRIS_ITEMS.filter((i) => i.form === form);
  if (items.length === 0) return counts;
  const current = sql.join(
    items.map((i) => sql`(${i.id}, ${i.version}, ${i.subject})`),
    sql`, `,
  );
  const rows = await db.execute<{ subject: string; n: number }>(sql`
    select v.subject, count(*)::int as n
      from (values ${current}) as v(item_id, item_version, subject)
      join ${irisItemReviews} r
        on r.item_id = v.item_id and r.item_version = v.item_version and r.status = 'approved'
     group by v.subject`);
  for (const r of rows.rows) counts[r.subject as SubjectKey] = r.n;
  return counts;
}

/** Whether a subject has enough approved questions to be taken live. */
export const isLive = (approved: number) => approved >= ENGINE.MIN;

export type ReviewChange = { id: string; status: IrisReviewStatus; note?: string };

export type SetReviewError = "unknown_item";

/** Records `changes` as `reviewerId`'s decisions on the questions' current versions. */
export async function setReviews(
  reviewerId: string,
  changes: readonly ReviewChange[],
): Promise<{ ok: true; written: number } | { ok: false; error: SetReviewError; id: string }> {
  for (const c of changes) {
    if (!ITEMS_BY_ID.has(c.id)) return { ok: false, error: "unknown_item", id: c.id };
  }
  await db.transaction(async (tx) => {
    for (const c of changes) {
      const item = ITEMS_BY_ID.get(c.id)!;
      const values = {
        itemId: c.id,
        itemVersion: item.version,
        status: c.status,
        note: c.note ?? "",
        reviewerId,
        updatedAt: new Date(),
      };
      await tx
        .insert(irisItemReviews)
        .values(values)
        .onConflictDoUpdate({
          target: irisItemReviews.itemId,
          set: c.note === undefined
            ? { itemVersion: values.itemVersion, status: values.status, reviewerId, updatedAt: values.updatedAt }
            : { itemVersion: values.itemVersion, status: values.status, note: values.note, reviewerId, updatedAt: values.updatedAt },
        });
    }
  });
  return { ok: true, written: changes.length };
}

/** Every draft on one subject and form, approved at once. */
export async function approveDrafts(reviewerId: string, subject: SubjectKey, form: Form) {
  const items = itemsOf(subject, form);
  const reviews = await reviewsOf(items);
  const drafts = items.filter((i) => reviews.get(i.id)!.status === "draft");
  if (drafts.length === 0) return { ok: true as const, written: 0 };
  return setReviews(
    reviewerId,
    drafts.map((i) => ({ id: i.id, status: "approved" as const })),
  );
}

