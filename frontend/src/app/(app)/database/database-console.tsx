"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Play, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { riseChild, staggerParent } from "@/lib/motion";

type Ok = {
  ok: true;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  command: string;
};
type Err = { ok: false; error: string };
type Result = Ok | Err;

/** Tables whose rows are credentials — worth a nudge before someone selects * */
const SENSITIVE = new Set(["sessions", "accounts", "workshop_accounts"]);

/** Render one cell. Nulls read as muted NULL; JSON values are stringified. */
function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/60 italic">NULL</span>;
  }
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return <span className="break-all">{text}</span>;
}

export function DatabaseConsole({ tables }: { tables: string[] }) {
  const [sql, setSql] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  async function run() {
    if (sql.trim().length === 0 || pending) return;
    setPending(true);
    setTransportError(null);
    try {
      const res = await fetch("/api/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      if (res.status === 401 || res.status === 403) {
        setTransportError("You are not allowed to run queries.");
        setResult(null);
        return;
      }
      const body = (await res.json()) as Result;
      setResult(body);
    } catch {
      setTransportError("Could not reach the server.");
      setResult(null);
    } finally {
      setPending(false);
    }
  }

  function pick(table: string) {
    setSql(`select * from "${table}" limit 100;`);
  }

  const touchesSensitive = [...SENSITIVE].some((t) =>
    new RegExp(`\\b${t}\\b`).test(sql),
  );

  return (
    <motion.div
      variants={staggerParent(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <motion.div variants={riseChild}>
        <h1 className="text-2xl font-medium tracking-tight">Database</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-600" />
          Read-only console. Every query runs in a{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            READ ONLY
          </code>{" "}
          transaction — statements that write, create, or drop are rejected by
          Postgres.
        </p>
      </motion.div>

      {tables.length > 0 && (
        <motion.div variants={riseChild} className="flex flex-wrap gap-1.5">
          {tables.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pick(t)}
              className={cn(
                "rounded-md border px-2 py-1 font-mono text-xs transition-colors hover:border-brand-border hover:bg-brand/5",
                SENSITIVE.has(t) && "border-amber-500/40 text-amber-700 dark:text-amber-300",
              )}
              title={
                SENSITIVE.has(t)
                  ? "Contains credentials — select with care"
                  : `select * from ${t}`
              }
            >
              {t}
            </button>
          ))}
        </motion.div>
      )}

      <motion.div variants={riseChild}>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          placeholder="select * from workshop_runs order by created_at desc limit 50;"
          className="h-40 w-full resize-y rounded-lg border bg-slate-950 p-3 font-mono text-sm text-slate-100 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {touchesSensitive ? (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <TriangleAlert className="size-3.5" />
                This query reads a table that holds session or OAuth tokens.
              </span>
            ) : (
              <>
                Press{" "}
                <kbd className="rounded border bg-muted px-1 text-[10px]">
                  ⌘/Ctrl
                </kbd>{" "}
                +{" "}
                <kbd className="rounded border bg-muted px-1 text-[10px]">
                  Enter
                </kbd>{" "}
                to run.
              </>
            )}
          </span>
          <Button variant="brand" onClick={run} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Play />}
            {pending ? "Running…" : "Run query"}
          </Button>
        </div>
      </motion.div>

      {transportError && (
        <motion.div variants={riseChild}>
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-3 text-sm text-destructive">
              {transportError}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {result && !result.ok && (
        <motion.div variants={riseChild}>
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-3 font-mono text-sm text-destructive whitespace-pre-wrap">
              {result.error}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {result && result.ok && (
        <motion.div variants={riseChild} className="space-y-2">
          <p className="text-xs text-muted-foreground tnum">
            {result.command || "OK"} · {result.rowCount} row
            {result.rowCount === 1 ? "" : "s"} · {result.elapsedMs} ms
            {result.truncated && (
              <span className="text-amber-600 dark:text-amber-400">
                {" "}
                · showing first {result.rows.length}
              </span>
            )}
          </p>
          {result.columns.length === 0 ? (
            <Card>
              <CardContent className="py-3 text-sm text-muted-foreground">
                No result set.
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    {result.columns.map((c, i) => (
                      <th
                        key={i}
                        className="whitespace-nowrap px-3 py-2 font-medium"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-t transition-colors hover:bg-muted/40"
                    >
                      {row.map((v, ci) => (
                        <td
                          key={ci}
                          className="max-w-md px-3 py-1.5 align-top"
                        >
                          <Cell value={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
