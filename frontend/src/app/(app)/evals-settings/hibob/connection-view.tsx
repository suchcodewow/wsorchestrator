"use client";

/** The HiBob service user, and the button that imports every employee with it. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, DownloadCloud, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HIBOB_LIMITS } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import { formatWhen } from "../format";

export type ConnectionSummary = {
  serviceUserId: string;
  tail: string;
  updatedAt: string;
  updatedBy: string | null;
  lastImportAt: string | null;
  lastImportCount: number | null;
  lastImportError: string | null;
};

const ERRORS: Record<string, string> = {
  invalid: "Enter both the service user ID and its token.",
  rejected: "HiBob turned those credentials down. Check the ID and token, and that the service user can read people.",
  unreachable: "Could not reach HiBob.",
  bad_response: "HiBob answered with something unexpected.",
  no_key: "The server has no key to seal the token with — set HARNESS_TOKEN_ENC_KEY or AUTH_SECRET.",
  not_configured: "Save a HiBob service user first.",
  unreadable: "The saved token can't be unsealed — the server's key changed. Save the token again.",
  forbidden: "Your own role changed — reload the page.",
};

function message(body: { error?: string; detail?: string } | null, status: number) {
  const text = ERRORS[body?.error ?? ""] ?? `Something went wrong (${status}).`;
  return body?.detail && body.error !== "rejected" ? `${text} ${body.detail}` : text;
}

export function HibobConnectionView({
  connection,
  employeeCount,
  keyConfigured,
}: {
  connection: ConnectionSummary | null;
  employeeCount: number;
  keyConfigured: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(connection === null);
  const [serviceUserId, setServiceUserId] = useState(connection?.serviceUserId ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(kind: NonNullable<typeof busy>, url: string, init: RequestInit) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(message(body, res.status));
        return null;
      }
      router.refresh();
      return body;
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const ok = await send("save", "/api/evals/hibob/connection", {
      method: "PUT",
      body: JSON.stringify({ serviceUserId, token }),
    });
    if (ok) {
      setToken("");
      setEditing(false);
      setNotice("HiBob accepted the credentials and they are saved.");
    }
  }

  async function importNow() {
    const body = await send("import", "/api/evals/hibob/import", { method: "POST" });
    if (body) setNotice(`Imported ${body.count.toLocaleString()} employees from HiBob.`);
  }

  const canSave = serviceUserId.trim() !== "" && token.trim() !== "" && busy === null;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">HiBob import</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          eVals reads every active employee from HiBob with a service user, then
          keeps the people whose reporting line leads up to the org root below.
          An import replaces the previous one, so people who have left drop out.
        </p>
      </motion.div>

      {!keyConfigured && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          The server has no key to seal a token with. Set <code>HARNESS_TOKEN_ENC_KEY</code> or{" "}
          <code>AUTH_SECRET</code> first.
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="space-y-5 py-5">
            {editing ? (
              <form
                className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSave) void save();
                }}
              >
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Service user ID</span>
                  <Input
                    value={serviceUserId}
                    maxLength={HIBOB_LIMITS.serviceUserId}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    onChange={(e) => setServiceUserId(e.target.value)}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Token</span>
                  <Input
                    type="password"
                    value={token}
                    maxLength={HIBOB_LIMITS.token}
                    autoComplete="new-password"
                    spellCheck={false}
                    className="font-mono"
                    placeholder={connection ? `Replaces ••••${connection.tail}` : undefined}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" variant="brand" disabled={!canSave}>
                    {busy === "save" ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    Check and save
                  </Button>
                  {connection && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => {
                        setEditing(false);
                        setToken("");
                        setError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            ) : (
              connection && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5 text-sm">
                    <p>
                      Service user <span className="font-mono font-medium">{connection.serviceUserId}</span>, token{" "}
                      <span className="font-mono">••••{connection.tail}</span>
                    </p>
                    <p className="text-muted-foreground">
                      Saved {formatWhen(connection.updatedAt)}
                      {connection.updatedBy && <> by {connection.updatedBy}</>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => {
                        setEditing(true);
                        setNotice(null);
                      }}
                    >
                      <KeyRound className="size-3.5" />
                      Replace
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={async () => {
                        if (await send("remove", "/api/evals/hibob/connection", { method: "DELETE" })) {
                          setServiceUserId("");
                          setEditing(true);
                        }
                      }}
                    >
                      {busy === "remove" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      Remove
                    </Button>
                  </div>
                </div>
              )
            )}

            {connection && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <div className="space-y-0.5 text-sm">
                  {connection.lastImportAt ? (
                    <p>
                      Last imported {formatWhen(connection.lastImportAt)}:{" "}
                      <span className="font-medium">
                        {(connection.lastImportCount ?? employeeCount).toLocaleString()} employees
                      </span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">Nothing imported yet.</p>
                  )}
                  {connection.lastImportError && (
                    <p className="flex items-center gap-1.5 text-destructive">
                      <AlertTriangle className="size-3.5" />
                      The last attempt failed: {connection.lastImportError}
                    </p>
                  )}
                </div>
                <Button variant="brand" disabled={busy !== null} onClick={importNow}>
                  {busy === "import" ? <Loader2 className="animate-spin" /> : <DownloadCloud />}
                  {busy === "import" ? "Importing…" : "Import now"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}
      {notice && (
        <motion.p variants={riseChild} role="status" className="text-sm text-muted-foreground">
          {notice}
        </motion.p>
      )}
    </motion.div>
  );
}
