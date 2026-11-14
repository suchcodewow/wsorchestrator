/** What the Presentations routes accept, and the status each of their failures answers with. */

import { z } from "zod";
import { PRESENTATION_LIMITS } from "@/db/schema";
import { slidesFileId } from "./link";
import { PAGE_LIMITS, pageDocumentSchema } from "./page";

const name = z.string().trim().min(1).max(PRESENTATION_LIMITS.name);

export const createPresentationSchema = z.object({
  name,
  /** A Google Slides link, or the deck's bare Drive id. */
  link: z
    .string()
    .max(2_000)
    .refine((link) => slidesFileId(link) !== null, "not a Google Slides link"),
});

export const renamePresentationSchema = z.object({ name });

/** The Google page id of the slide a page comes before; null for last. */
const before = z.string().min(1).max(200).nullable();

export const createPageSchema = z.object({ before });

export const savePageSchema = z.object({
  before,
  document: pageDocumentSchema,
  notes: z.string().max(PAGE_LIMITS.notes),
});

export const PRESENTATION_STATUS = {
  not_found: 404,
  too_many_pages: 422,
  google_not_configured: 503,
  google_not_connected: 503,
  google_reconnect: 503,
  google_cannot_open: 422,
  too_many_slides: 422,
  failed: 502,
} as const;
