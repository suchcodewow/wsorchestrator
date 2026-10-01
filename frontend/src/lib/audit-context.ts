/**
 * What an audited request learns about itself while it runs: who called, and
 * anything the handler (or a lib it calls) wants on the record. `audited` in
 * `audit.ts` opens one per request; outside one, every function here does
 * nothing, so libs may call them unconditionally.
 */

import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditVia } from "@/db/schema";

export type AuditActor = { id: string; email: string | null; name?: string | null };

export type AuditNote = {
  target?: string;
  targetLabel?: string;
  detail?: Record<string, unknown>;
};

export type AuditScope = {
  actor?: AuditActor;
  via?: AuditVia;
  note: AuditNote;
};

export const auditScope = new AsyncLocalStorage<AuditScope>();

/** Called by `sessionOrToken` once it knows who is calling. */
export function noteCaller(actor: AuditActor, via: AuditVia): void {
  const scope = auditScope.getStore();
  if (!scope) return;
  scope.actor = actor;
  scope.via = via;
}

/**
 * Adds to the record of the current request: what it acted on, by id and by
 * name, and any detail worth keeping. Later calls win, field by field.
 */
export function noteAudit(note: AuditNote): void {
  const scope = auditScope.getStore();
  if (!scope) return;
  scope.note = {
    ...scope.note,
    ...note,
    detail: note.detail ? { ...scope.note.detail, ...note.detail } : scope.note.detail,
  };
}
