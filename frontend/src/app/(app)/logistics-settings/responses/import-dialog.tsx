"use client";

/**
 * Brings a Google Form's responses sheet into the intake form shown: the file
 * is checked first, showing which column answers which question and how many
 * of the people are in the current cohort, and only stored when imported.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { IntakeFormId, IntakeQuestion } from "@/db/schema";
import { INTAKE_FORM_LABELS } from "@/lib/logistics/intake-values";
import type { IntakeImportSummary } from "@/lib/logistics/intake-import";

const ERRORS: Record<string, string> = {
  no_file: "Choose the responses file first.",
  too_large: "That file is over 2 MB, or has more than 2,000 rows.",
  unreadable: "That file could not be read. Download the responses sheet as .csv or .xlsx and try again.",
  empty: "That file has no responses in it.",
  no_email_column: "There is no Email Address column. Turn on collecting emails in the Google Form, or add the column, and download it again.",
  forbidden: "Your own role changed — reload the page.",
};

const PROBLEMS = { no_email: "has no email", not_an_email: "has something other than an email" } as const;

export function ImportResponsesDialog({
  form,
  questions,
  open,
  onClose,
}: {
  form: IntakeFormId;
  questions: IntakeQuestion[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<IntakeImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titles = new Map(questions.map((q) => [q.id, q.title]));

  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) {
      setFile(null);
      setSummary(null);
      setError(null);
    }
  }

  async function send(commit: boolean) {
    if (!file) return setError(ERRORS.no_file!);
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/logistics/intake-responses/import?form=${form}${commit ? "&commit=1" : ""}`, {
        method: "POST",
        body,
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) return setError(ERRORS[out?.error ?? ""] ?? `Could not read it (${res.status}).`);
      setSummary(out as IntakeImportSummary);
      if (commit) router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const matched = summary?.columns.filter((c) => c.questionId) ?? [];
  const unused = summary?.columns.filter((c) => !c.questionId && !/^(timestamp|email( address)?)$/i.test(c.header.trim())) ?? [];
  const unasked = summary ? questions.filter((q) => !matched.some((c) => c.questionId === q.id)) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import {INTAKE_FORM_LABELS[form]} responses</DialogTitle>
        </DialogHeader>

        {summary?.imported ? (
          <div className="space-y-2 py-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4 text-brand" />
              Imported {summary.added.toLocaleString()} {summary.added === 1 ? "response" : "responses"}
            </p>
            {summary.alreadyThere > 0 && (
              <p className="text-muted-foreground">{summary.alreadyThere.toLocaleString()} were already here and left as they were.</p>
            )}
            <p className="text-muted-foreground">
              {summary.inCohort.toLocaleString()} of {summary.people.toLocaleString()} people are in the current cohort, so
              show on Dietary needs.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <label htmlFor="import-file" className="text-sm font-medium">
                Responses sheet
              </label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setSummary(null);
                }}
              />
              <p className="text-xs text-muted-foreground">
                In the Google Form&apos;s responses sheet: File → Download → .csv or .xlsx. Columns are matched to questions
                by their titles.
              </p>
            </div>

            {summary && (
              <div className="divide-y overflow-hidden rounded-xl border text-sm">
                <div className="px-4 py-3">
                  <span className="font-medium">{summary.added.toLocaleString()}</span> to import from{" "}
                  {summary.people.toLocaleString()} {summary.people === 1 ? "person" : "people"}
                  {summary.alreadyThere > 0 && <>, {summary.alreadyThere.toLocaleString()} already here</>}.{" "}
                  <span className="text-muted-foreground">
                    {summary.inCohort.toLocaleString()} are in the current cohort, so will show on Dietary needs.
                  </span>
                </div>
                <div className="space-y-1.5 px-4 py-3">
                  <p className="font-medium">Matched</p>
                  {matched.length === 0 ? (
                    <p className="text-muted-foreground">No column matched a question.</p>
                  ) : (
                    <ul className="space-y-1">
                      {matched.map((c, i) => (
                        <li key={i} className="text-muted-foreground">
                          <span className="text-foreground">{titles.get(c.questionId!)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {(unused.length > 0 || unasked.length > 0) && (
                  <div className="space-y-1.5 px-4 py-3 text-muted-foreground">
                    {unused.length > 0 && (
                      <p>
                        <span className="font-medium text-foreground">Not imported:</span>{" "}
                        {unused.map((c) => `“${c.header.trim()}”`).join(", ")}, as the form asks no question with that title.
                      </p>
                    )}
                    {unasked.length > 0 && (
                      <p>
                        <span className="font-medium text-foreground">No column for:</span>{" "}
                        {unasked.map((q) => `“${q.title}”`).join(", ")}.
                      </p>
                    )}
                  </div>
                )}
                {summary.problems.length > 0 && (
                  <div className="px-4 py-3 text-destructive">
                    {summary.problems.map((p) => `Row ${p.row} ${PROBLEMS[p.problem]}`).join("; ")}, so is skipped.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {summary?.imported ? "Close" : "Cancel"}
          </Button>
          {!summary?.imported &&
            (summary ? (
              <Button type="button" variant="brand" disabled={busy || summary.added === 0} onClick={() => send(true)}>
                {busy ? <Loader2 className="animate-spin" /> : <Upload />}
                Import {summary.added.toLocaleString()} {summary.added === 1 ? "response" : "responses"}
              </Button>
            ) : (
              <Button type="button" variant="brand" disabled={busy || !file} onClick={() => send(false)}>
                {busy && <Loader2 className="animate-spin" />}
                Check the file
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
