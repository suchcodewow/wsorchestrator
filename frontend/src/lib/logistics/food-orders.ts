/**
 * Food orders for a bootcamp: who each is from, when it arrives, what the
 * training team needs from it, and the vendor's PDF.
 */

import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { FOOD_ORDER_LIMITS, foodOrders } from "@/db/schema";
import type { FoodOrderSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isUuid } from "@/lib/utils";

export type FoodOrderRow = {
  id: string;
  vendor: string;
  arrivesAt: string;
  needs: string;
  fileName: string | null;
  fileBytes: number | null;
  /** True once its arrival time has passed. */
  arrived: boolean;
  updatedAt: string;
};

const COLUMNS = {
  id: foodOrders.id,
  vendor: foodOrders.vendor,
  arrivesAt: foodOrders.arrivesAt,
  needs: foodOrders.needs,
  fileName: foodOrders.fileName,
  fileBytes: foodOrders.fileBytes,
  arrived: sql<boolean>`${foodOrders.arrivesAt} < now()`,
  updatedAt: foodOrders.updatedAt,
};

const SORT_COLUMNS = {
  arrivesAt: foodOrders.arrivesAt,
  vendor: sql`lower(${foodOrders.vendor})`,
  updatedAt: foodOrders.updatedAt,
};

const toRow = (r: Omit<FoodOrderRow, "arrivesAt" | "updatedAt"> & { arrivesAt: Date; updatedAt: Date }): FoodOrderRow => ({
  ...r,
  arrivesAt: r.arrivesAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** Every order, a page at a time, the soonest to arrive first; searched by vendor and what is needed. */
export async function listFoodOrders(query: ListQuery<FoodOrderSort>): Promise<Page<FoodOrderRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(COLUMNS)
    .from(foodOrders)
    .where(searchAny(query.q, [foodOrders.vendor, foodOrders.needs, foodOrders.fileName]))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, foodOrders.arrivesAt, foodOrders.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows.map(toRow), query.page);
}

/** The orders the print sheet lists: the ones named, in arrival order, or none if no id is one. */
export async function foodOrdersById(ids: string[]): Promise<FoodOrderRow[]> {
  const valid = ids.filter(isUuid).slice(0, 100);
  if (valid.length === 0) return [];
  const rows = await db
    .select(COLUMNS)
    .from(foodOrders)
    .where(inArray(foodOrders.id, valid))
    .orderBy(foodOrders.arrivesAt, foodOrders.id);
  return rows.map(toRow);
}

/** One order's PDF, or null if there is no such order or it has none. */
export async function getFoodOrderFile(id: string): Promise<{ name: string; data: Buffer } | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({ name: foodOrders.fileName, data: foodOrders.fileData })
    .from(foodOrders)
    .where(eq(foodOrders.id, id));
  return row?.data ? { name: row.name ?? "order.pdf", data: row.data } : null;
}

export const foodOrderFieldsSchema = z.object({
  vendor: z.string().trim().min(1).max(FOOD_ORDER_LIMITS.vendor),
  arrivesAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)),
  needs: z.string().max(FOOD_ORDER_LIMITS.needs).default(""),
});

export type FoodOrderFields = z.infer<typeof foodOrderFieldsSchema>;

/** A PDF as uploaded, its name trimmed to fit. */
export type FoodOrderFile = { name: string; data: Buffer };

export type FoodOrderFormError = "invalid" | "not_pdf" | "too_large";

export const FORM_STATUS: Record<FoodOrderFormError, number> = { invalid: 400, not_pdf: 415, too_large: 413 };

/**
 * The fields and file from a multipart body. `file` is undefined where none
 * was sent, which keeps the PDF an order has, and null where `removeFile` is
 * "1", which drops it.
 */
export async function readFoodOrderForm(
  form: FormData,
): Promise<{ ok: true; fields: FoodOrderFields; file: FoodOrderFile | null | undefined } | { ok: false; error: FoodOrderFormError }> {
  const parsed = foodOrderFieldsSchema.safeParse({
    vendor: form.get("vendor"),
    arrivesAt: form.get("arrivesAt"),
    needs: form.get("needs") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size === 0) {
    return { ok: true, fields: parsed.data, file: form.get("removeFile") === "1" ? null : undefined };
  }
  if (upload.size > FOOD_ORDER_LIMITS.bytes) return { ok: false, error: "too_large" };

  const data = Buffer.from(await upload.arrayBuffer());
  // Every PDF starts with this, whatever the browser says its type is.
  if (data.subarray(0, 5).toString("latin1") !== "%PDF-") return { ok: false, error: "not_pdf" };

  const name = (upload.name.trim() || "order.pdf").slice(0, FOOD_ORDER_LIMITS.fileName);
  return { ok: true, fields: parsed.data, file: { name, data } };
}

const fileColumns = (file: FoodOrderFile | null) => ({
  fileName: file?.name ?? null,
  fileBytes: file?.data.byteLength ?? null,
  fileData: file?.data ?? null,
});

export async function createFoodOrder(
  actorId: string,
  fields: FoodOrderFields,
  file: FoodOrderFile | null | undefined,
): Promise<FoodOrderRow> {
  const [row] = await db
    .insert(foodOrders)
    .values({ ...fields, ...fileColumns(file ?? null), createdBy: actorId })
    .returning(COLUMNS);
  return toRow(row!);
}

/** Changes an order's fields, and its PDF unless `file` is undefined; null if there is no such order. */
export async function updateFoodOrder(
  id: string,
  fields: FoodOrderFields,
  file: FoodOrderFile | null | undefined,
): Promise<FoodOrderRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(foodOrders)
    .set({ ...fields, ...(file === undefined ? {} : fileColumns(file)), updatedAt: new Date() })
    .where(eq(foodOrders.id, id))
    .returning(COLUMNS);
  return row ? toRow(row) : null;
}

/** The vendor of the order removed, or null if there was none. */
export async function deleteFoodOrder(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.delete(foodOrders).where(eq(foodOrders.id, id)).returning({ vendor: foodOrders.vendor });
  return row?.vendor ?? null;
}
