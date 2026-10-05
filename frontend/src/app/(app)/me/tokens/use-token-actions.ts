"use client";

/**
 * Every request the tokens page makes, and the one busy / error / saved state
 * they share. One action runs at a time; starting one clears the last message.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeployReport } from "@/lib/harness-deploy";
import { messageFor as deployMessageFor } from "@/lib/harness-deploy-errors";
import type { DeploySelection } from "@/lib/harness-deploy-selection";
import { messageFor as tokenMessageFor } from "@/lib/harness-token-errors";
import type { ScrubRun } from "@/lib/harness-scrub";
import type { HarnessTokenSummary } from "@/lib/harness-tokens";
import { plural, tokenName } from "./format";

/** Which action is running: the save form's, or one token row's. */
export type BusyKey = "save" | `${RowAction}:${string}`;
/** Re-check and remove share a key: either one locks the row's buttons. */
type RowAction = "row" | "scrub" | "deploy";

type ErrorBody = { error?: unknown; detail?: unknown };
type MessageFor = (error: unknown, status: number, detail?: unknown) => string;

/** What each route answers on success; see `src/app/api/me/harness-tokens/`. */
type SavedResponse = { token: HarnessTokenSummary };
type RemovedResponse = { scrub: ScrubRun | null };
type ScrubbedResponse = { run: ScrubRun };
type DeployedResponse = { report: DeployReport };

const UNREACHABLE = "Could not reach the server.";

export function useTokenActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function request<T>(
    key: BusyKey,
    path: string,
    init: RequestInit,
    { messageFor = tokenMessageFor, unreachable = UNREACHABLE }: { messageFor?: MessageFor; unreachable?: string } = {},
  ): Promise<T | null> {
    setBusy(key);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...init.headers },
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || body === null) {
        const failed = (body ?? {}) as ErrorBody;
        setError(messageFor(failed.error, res.status, failed.detail));
        return null;
      }
      return body as T;
    } catch {
      setError(unreachable);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save(token: string): Promise<boolean> {
    const body = await request<SavedResponse>("save", "/api/me/harness-tokens", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    if (!body) return false;

    const { permissions } = body.token;
    setSaved(
      `Saved for ${tokenName(body.token)} — ${
        permissions.filter((p) => p.permitted).length
      } of ${permissions.length} checked permissions granted.`,
    );
    router.refresh();
    return true;
  }

  async function recheck(id: string) {
    if (await request(`row:${id}`, `/api/me/harness-tokens/${id}`, { method: "POST" })) {
      setSaved("Re-checked with Harness.");
      router.refresh();
    }
  }

  async function remove(id: string) {
    const body = await request<RemovedResponse>(`row:${id}`, `/api/me/harness-tokens/${id}`, {
      method: "DELETE",
    });
    if (!body) return;

    const { scrub } = body;
    if (scrub && scrub.problems.length > 0) {
      setError(
        `Token removed, but ${scrub.problems.length} of this site's secrets ` +
          `need removing in Harness by hand: ${scrub.problems
            .map((p) => p.secretIdentifier)
            .join(", ")}.`,
      );
    } else if (scrub && scrub.scrubbed > 0) {
      setSaved(
        `Token removed, and ${scrub.scrubbed} deployed secret${plural(scrub.scrubbed)} ` +
          `scrubbed from Harness on the way out.`,
      );
    }
    router.refresh();
  }

  async function scrub(id: string): Promise<ScrubRun | null> {
    const body = await request<ScrubbedResponse>(`scrub:${id}`, `/api/me/harness-tokens/${id}/scrub`, {
      method: "POST",
    });
    if (!body) return null;
    router.refresh();
    return body.run;
  }

  async function deploy(id: string, org: string, selection: DeploySelection): Promise<DeployReport | null> {
    const body = await request<DeployedResponse>(
      `deploy:${id}`,
      `/api/me/harness-tokens/${id}/deploy`,
      { method: "POST", body: JSON.stringify({ org, ...selection }) },
      {
        messageFor: deployMessageFor,
        unreachable: "Lost contact with the server while deploying — check the organization in Harness first.",
      },
    );
    if (!body) return null;
    router.refresh();
    return body.report;
  }

  return { busy, error, saved, save, recheck, remove, scrub, deploy };
}
