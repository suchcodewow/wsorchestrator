"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CLAIM_LIMITS, type RunStatus } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
// Type-only: erased at compile time, so the `server-only` module behind it is
// never pulled into the client bundle.
import type { AttendeeView } from "@/lib/attendees";

/**
 * `claimedAt` is a Date on the server-rendered pass and a string once it has
 * been through JSON on a poll. It is only ever read as "does this row have a
 * name yet", so the union is the honest type rather than a lie in one direction.
 */
type Row = Omit<AttendeeView["accounts"][number], "claimedAt"> & {
  claimedAt: string | Date | null;
};
type View = Omit<AttendeeView, "accounts"> & { accounts: Row[] };

type Fields = { name: string; from: string; vacation: string };
type FieldName = keyof Fields;
const EMPTY: Fields = { name: "", from: "", vacation: "" };

/** Statuses where the room's answers can still change and are worth polling. */
const TERMINAL = new Set<RunStatus>(["destroyed", "failed"]);

/** The current values for a row, from its persisted answers. */
function fieldsOf(a: Row): Fields {
  return {
    name: a.claimedName ?? "",
    from: a.claimedFrom ?? "",
    vacation: a.claimedVacation ?? "",
  };
}

function seed(accounts: Row[]): Record<number, Fields> {
  return Object.fromEntries(accounts.map((a) => [a.id, fieldsOf(a)]));
}

/** The IAM page for a project — where an attendee checks their own access. */
function iamUrl(projectId: string): string {
  return `https://console.cloud.google.com/iam-admin/iam?project=${encodeURIComponent(
    projectId,
  )}`;
}

/** How long after the last keystroke a row's answers are saved. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * One shared column template. The header and every row read from the same
 * constant so they cannot drift out of alignment.
 *
 * Below `md` the template does not apply at all and each row stacks into a
 * labelled card — a five-column table is unusable on the phone most attendees
 * will actually open this link on.
 */
const COLUMNS =
  "md:grid-cols-[minmax(0,21rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]";

export function AttendeeGrid({
  initial,
  runId,
}: {
  initial: View;
  runId: string;
}) {
  const [data, setData] = useState<View>(initial);
  const [values, setValues] = useState<Record<number, Fields>>(() =>
    seed(initial.accounts),
  );

  // The latest values, for the debounced save to read without re-closing.
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  // A poll must not yank a field out from under someone. A row is held to its
  // local values while it is focused or has an edit that has not been confirmed
  // saved; every other row takes the server's values, which is how one person's
  // typing reaches everyone else.
  const focusedRef = useRef<{ id: number; field: FieldName } | null>(null);
  const dirtyRef = useRef<Set<number>>(new Set());
  // Per-row edit counter, so a save only clears "dirty" if nothing was typed
  // while it was in flight (otherwise the newer local edit would be clobbered).
  const genRef = useRef<Record<number, number>>({});
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/attend/${runId}`, { cache: "no-store" });
    if (!res.ok) return;
    const view: View = await res.json();
    setData(view);
    setValues((prev) => {
      const next: Record<number, Fields> = {};
      for (const a of view.accounts) {
        const held =
          focusedRef.current?.id === a.id || dirtyRef.current.has(a.id);
        next[a.id] = held && prev[a.id] ? prev[a.id] : fieldsOf(a);
      }
      return next;
    });
  }, [runId]);

  // Keep the page live for the whole event: answers keep flowing in, and other
  // people's edits only appear via these polls. A finished event is static.
  const live = !TERMINAL.has(data.status);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [live, refresh]);

  // Flush any pending debounce timers when the page goes away.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const save = useCallback(
    async (id: number) => {
      const gen = genRef.current[id] ?? 0;
      const fields = valuesRef.current[id] ?? EMPTY;
      try {
        const res = await fetch(`/api/attend/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: id, ...fields }),
        });
        if (!res.ok) return; // keep the row dirty so a poll won't overwrite it
        // Nothing typed since this save started — safe to let polls take over.
        if ((genRef.current[id] ?? 0) === gen) dirtyRef.current.delete(id);
      } catch {
        // Offline or a blip; the row stays dirty and the next edit re-saves.
      }
    },
    [runId],
  );

  const edit = useCallback(
    (id: number, field: FieldName, value: string) => {
      setValues((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? EMPTY), [field]: value },
      }));
      dirtyRef.current.add(id);
      genRef.current[id] = (genRef.current[id] ?? 0) + 1;
      clearTimeout(timersRef.current[id]);
      timersRef.current[id] = setTimeout(() => void save(id), SAVE_DEBOUNCE_MS);
    },
    [save],
  );

  const focus = useCallback((id: number, field: FieldName) => {
    focusedRef.current = { id, field };
  }, []);
  const blur = useCallback((id: number, field: FieldName) => {
    if (focusedRef.current?.id === id && focusedRef.current.field === field) {
      focusedRef.current = null;
    }
  }, []);

  const filledCount = data.accounts.filter((a) => a.claimedAt).length;
  const noun = data.mode === "challenge" ? "competitor" : "attendee";
  // Azure sign-in takes a different credential, which is worth explaining once
  // under the table rather than on every row — but only for an event that has
  // one, since most do not.
  const hasAccessPass = data.accounts.some((a) => a.azureAccessPass);

  return (
    <motion.div
      variants={staggerParent(0.05)}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <motion.div variants={riseChild}>
        <h1 className="text-2xl font-medium tracking-tight text-balance">
          {data.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.accounts.length > 0
            ? `Grab a row, sign in with those credentials, and put your name on it. Type anywhere — it saves for the whole room as you go. ${filledCount} of ${data.accounts.length} filled in.`
            : `Accounts for this ${data.mode} will appear here.`}
        </p>
        {/* A workshop shares one environment per cloud, so its links live up
            here rather than repeated on every row (challenges link per
            competitor below). A multi-cloud workshop shows one button each. */}
        {(data.gcpProjectId || data.azurePortalUrl) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.gcpProjectId && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={iamUrl(data.gcpProjectId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink />
                  Open Google Cloud IAM
                </a>
              </Button>
            )}
            {data.azurePortalUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={data.azurePortalUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open Azure portal
                </a>
              </Button>
            )}
          </div>
        )}
      </motion.div>

      {data.accounts.length === 0 ? (
        <motion.div variants={riseChild}>
          <EmptyState status={data.status} noun={noun} />
        </motion.div>
      ) : (
        <>
          <motion.div variants={riseChild}>
            <Card>
              <CardContent className="px-0">
                {/* Column headings, wide screens only — each stacked card
                    below `md` carries its own inline labels instead. */}
                <div
                  className={cn(
                    "hidden gap-4 border-b px-6 pb-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase md:grid",
                    COLUMNS,
                  )}
                >
                  <span>Account</span>
                  <span>Your name</span>
                  <span>Where you&rsquo;re from</span>
                  <span>Favourite vacation</span>
                  <span className={data.mode === "challenge" ? "" : "sr-only"}>
                    {data.mode === "challenge" ? "Cloud" : "Cloud link"}
                  </span>
                </div>

                <ul className="divide-y">
                  {data.accounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      values={values[account.id] ?? EMPTY}
                      onEdit={(field, value) => edit(account.id, field, value)}
                      onFocus={(field) => focus(account.id, field)}
                      onBlur={(field) => blur(account.id, field)}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>

          <motion.p
            variants={riseChild}
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {/* No "you'll be asked to change your password": the accounts are
                created without a forced reset on purpose, so the one password
                keeps working across every cloud this event uses. */}
            The password above is the one to use everywhere &mdash; there is
            nothing to change and nothing to enrol.
            {hasAccessPass && (
              <>
                {" "}
                Azure is the exception: it asks for the <em>Azure pass</em>{" "}
                instead of the password, and you may need to choose
                &ldquo;Use your Temporary Access Pass&rdquo; on the sign-in
                screen to be asked for it.
              </>
            )}{" "}
            These accounts and everything in them are deleted when the{" "}
            {data.mode} ends.
          </motion.p>
        </>
      )}
    </motion.div>
  );
}

function AccountRow({
  account,
  values,
  onEdit,
  onFocus,
  onBlur,
}: {
  account: Row;
  values: Fields;
  onEdit: (field: FieldName, value: string) => void;
  onFocus: (field: FieldName) => void;
  onBlur: (field: FieldName) => void;
}) {
  const filled = Boolean(account.claimedAt);

  return (
    <li
      className={cn(
        "gap-4 px-6 py-4 transition-colors md:grid md:items-center",
        COLUMNS,
        filled ? "bg-muted/20" : "hover:bg-accent/20",
      )}
    >
      <div className="min-w-0">
        <Credential value={account.email} label="email" />
        <Credential value={account.tempPassword} label="password" muted />
        {/* Azure asks for this instead of the password — see the note under
            the table. Labelled as expired rather than hidden once it lapses:
            an attendee who cannot sign in needs to know which credential went
            stale, not to find the row it used to be on. */}
        {account.azureAccessPass && (
          <Credential
            value={account.azureAccessPass}
            label={`Azure pass${accessPassExpired(account) ? " (expired)" : ""}`}
            prefix={`Azure pass${accessPassExpired(account) ? " (expired)" : ""}`}
            muted
          />
        )}
      </div>

      <Field
        label="Your name"
        value={values.name}
        maxLength={CLAIM_LIMITS.name}
        placeholder="Your name"
        onChange={(v) => onEdit("name", v)}
        onFocus={() => onFocus("name")}
        onBlur={() => onBlur("name")}
        className="mt-3 md:mt-0"
      />
      <Field
        label="Where you're from"
        value={values.from}
        maxLength={CLAIM_LIMITS.from}
        placeholder="Chicago"
        onChange={(v) => onEdit("from", v)}
        onFocus={() => onFocus("from")}
        onBlur={() => onBlur("from")}
      />
      <Field
        label="Favourite vacation"
        value={values.vacation}
        maxLength={CLAIM_LIMITS.vacation}
        placeholder="Two weeks in Lisbon"
        onChange={(v) => onEdit("vacation", v)}
        onFocus={() => onFocus("vacation")}
        onBlur={() => onBlur("vacation")}
      />

      {/* Per-competitor link on a challenge — IAM on GCP, the portal on Azure.
          A challenge runs on a single cloud, so only one of these is ever set.
          Workshops link once above, so their rows leave this cell out entirely
          (no empty gap on mobile). */}
      {account.gcpProjectId && (
        <div className="mt-3 md:mt-0 md:text-right">
          <Button variant="outline" size="sm" className="w-full md:w-auto" asChild>
            <a
              href={iamUrl(account.gcpProjectId)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />
              IAM
            </a>
          </Button>
        </div>
      )}
      {account.azurePortalUrl && (
        <div className="mt-3 md:mt-0 md:text-right">
          <Button variant="outline" size="sm" className="w-full md:w-auto" asChild>
            <a href={account.azurePortalUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              Portal
            </a>
          </Button>
        </div>
      )}
    </li>
  );
}

/** Whether this account's Azure access pass has already lapsed. */
function accessPassExpired(account: Row): boolean {
  const at = account.azureAccessPassExpiresAt;
  return at ? new Date(at).getTime() <= Date.now() : false;
}

/** An email or password, with the copy button attendees will actually need. */
function Credential({
  value,
  label,
  prefix,
  muted = false,
}: {
  value: string;
  label: string;
  /**
   * Names the credential in front of it. Email and password are recognisable
   * on sight and go without; a third value on the row is not, and an attendee
   * looking at two opaque strings has to be told which one Azure wants.
   */
  prefix?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start gap-1.5">
      {/* Wrapped rather than truncated: an attendee has to be able to read the
          whole address to type it into a sign-in box, and generated addresses
          run longer than any column width worth giving them. */}
      <span
        className={cn(
          "min-w-0 font-mono text-sm break-all",
          muted && "text-muted-foreground",
        )}
      >
        {prefix && (
          <span className="mr-1.5 font-sans text-xs text-muted-foreground">
            {prefix}
          </span>
        )}
        {value}
      </span>
      <CopyButton value={value} label={label} />
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        // Blocked outside a secure context and in some embedded browsers;
        // the text is on screen either way, so a failure is not worth a error.
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          return;
        }
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-60 transition-opacity outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}

/** One shared answer input, with the label that only shows when stacked. */
function Field({
  label,
  value,
  maxLength,
  placeholder,
  onChange,
  onFocus,
  onBlur,
  className,
}: {
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs text-muted-foreground md:hidden">
        {label}
      </span>
      <Input
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </label>
  );
}

/** Shown when the event has no accounts yet — or no longer has any. */
function EmptyState({ status, noun }: { status: RunStatus; noun: string }) {
  const pending =
    status === "scheduled" ||
    status === "requested" ||
    status === "provisioning" ||
    status === "applying";
  const message =
    status === "scheduled"
      ? "This event hasn't started yet. Accounts appear here automatically once it's provisioned."
      : pending
        ? `Accounts are being created right now. This page updates itself — no need to reload.`
        : status === "failed"
          ? "This event didn't finish setting up. Check with your organizer."
          : `This event has ended and its ${noun} accounts have been deleted.`;

  return (
    <Card>
      <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
        {pending && status !== "scheduled" && (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        )}
        {message}
      </CardContent>
    </Card>
  );
}
