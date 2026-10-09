"use client";

/**
 * The recording link, to copy and share, and every take recorded there: who recorded it, when, how long, whether it has the screen, and
 * where its upload stands. A row opens the take. While anything is still
 * uploading the page refreshes itself.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Copy, ExternalLink } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecordingSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatBytes, formatDuration } from "@/lib/recording/format";
import { RECORDING_RETENTION_DAYS } from "@/lib/recording/video";
import type { RecordingTakeRow } from "@/lib/recording/recordings";
import { formatWhen } from "./format";
import { TakeStatus } from "./take-status";

const REFRESH_MS = 5_000;

export function RecordingsView({ query, page }: { query: ListQuery<RecordingSort>; page: Page<RecordingTakeRow> }) {
  const router = useRouter();
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  const pending = page.rows.some((r) => r.status === "uploading" || r.status === "assembling");

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [pending, router]);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.h1 variants={riseChild} className="text-3xl font-medium tracking-tight">
        Async Recordings
      </motion.h1>

      <LinkCard />

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by who recorded it" label="Search recordings" className="max-w-md" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="contributor" {...sortProps}>
                  Recorded by
                </SortHeader>
                <SortHeader column="startedAt" {...sortProps} className="w-44">
                  Recorded
                </SortHeader>
                <PlainHeader className="w-24">Length</PlainHeader>
                <PlainHeader className="w-36">Includes</PlainHeader>
                <PlainHeader className="w-24">Size</PlainHeader>
                <PlainHeader className="w-32">Status</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No recordings match that search." : "No recordings yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((r) => {
                const href = `/recordings/${r.takeId}`;
                return (
                  <tr key={r.takeId} className={LINK_ROW} onClick={rowLink(href)}>
                    <td className="px-5 py-3 font-medium">
                      <Link href={href} className="group-hover:underline">
                        {r.contributor || <span className="text-muted-foreground">No name given</span>}
                      </Link>
                    </td>
                    <td className="px-5 py-3 tabular-nums" suppressHydrationWarning>
                      {formatWhen(r.startedAt)}
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      {r.durationMs !== null ? formatDuration(r.durationMs) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-5 py-3">{r.kinds.includes("screen") ? "Camera and screen" : "Camera"}</td>
                    <td className="px-5 py-3 tabular-nums">
                      {r.bytes > 0 ? formatBytes(r.bytes) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <TakeStatus status={r.status} stalled={r.stalled} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="recordings" />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** The one address everyone records at, to copy and share: anyone in the org, once signed in. */
function LinkCard() {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address the link is shared from is only known in the browser
    setOrigin(window.location.origin);
  }, []);

  const url = `${origin}/record`;

  async function copy() {
    await navigator.clipboard.writeText(url).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <motion.div variants={riseChild} className="space-y-3 rounded-2xl border bg-card px-5 py-4 text-sm shadow-sm">
      <h2 className="text-base font-medium">Recording link</h2>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Recording link"
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="min-w-64 flex-1 font-mono text-xs"
        />
        <Button variant="brand" onClick={() => void copy()} disabled={!origin}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" asChild>
          <a href="/record" target="_blank" rel="noreferrer">
            <ExternalLink />
            Open
          </a>
        </Button>
      </div>
      <p className="text-muted-foreground">
        Anyone in the org can record there once they sign in with Google; they need no role here.{" "}
        {`Recordings are deleted ${RECORDING_RETENTION_DAYS} days after they're made.`}
      </p>
    </motion.div>
  );
}
