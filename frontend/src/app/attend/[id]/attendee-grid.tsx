"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CLAIM_LIMITS, type Cloud, type RunStatus } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Check, ChevronDown, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
// Type-only: erased at compile time, so the `server-only` module behind it is
// never pulled into the client bundle.
import type { AttendeeView, CloudLink } from "@/lib/attendees";

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

/**
 * What each cloud's environment is called, on the button that opens it. Names
 * the resource rather than the provider's console — "resource group" is what
 * an attendee is looking for once they are signed in.
 */
const CLOUD_RESOURCE: Record<Cloud, string> = {
  gcp: "Google",
  azure: "Azure",
  aws: "AWS",
};

/** The button that opens one cloud's environment. */
function CloudButton({ link, className }: { link: CloudLink; className?: string }) {
  return (
    <LinkButton href={link.url} className={className}>
      {CLOUD_RESOURCE[link.cloud]}
    </LinkButton>
  );
}

/** One "open this somewhere else" button — a cloud environment, the Harness org. */
function LinkButton({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Button variant="outline" size="sm" className={className} asChild>
      <a href={href} target="_blank" rel="noreferrer">
        <ExternalLink />
        {children}
      </a>
    </Button>
  );
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
 *
 * The last column is the row's Details toggle: everything that is not the
 * address or one of the three answers — passwords, the Azure pass, the link
 * into this competitor's environment — lives behind it.
 */
const COLUMNS = "md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]";

export function AttendeeGrid({ initial, runId }: { initial: View; runId: string }) {
  const [data, setData] = useState<View>(initial);
  const [values, setValues] = useState<Record<number, Fields>>(() => seed(initial.accounts));

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
        const held = focusedRef.current?.id === a.id || dirtyRef.current.has(a.id);
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
  // AWS is the one cloud the Google password does not open, so say so once
  // under the table — but only for an event that actually built one.
  const hasAwsPassword = data.accounts.some((a) => a.awsPassword);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <h1 className="text-2xl font-medium tracking-tight text-balance">{data.name}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {data.accounts.length > 0
            ? `Take a row, put your name on it, and open Details for the password to sign in with. ${filledCount} of ${data.accounts.length} taken.`
            : `Accounts for this ${data.mode} will appear here.`}
        </p>
        {/* Everywhere the room is expected to go, in one place: the Harness
            org every event provisions, then a workshop's shared environment
            per cloud (challenges link per competitor on their own row). */}
        {(data.harnessOrgUrl || data.links.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.harnessOrgUrl && <LinkButton href={data.harnessOrgUrl}>Open Harness organization</LinkButton>}
            {data.links.map((link) => (
              <CloudButton key={link.cloud} link={link} />
            ))}
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
                    below `md` carries its own inline labels instead.

                    Every heading is indented to sit directly over the first
                    character of what is under it: the three answer columns are
                    text inputs, whose text starts one `px-3` in from the
                    column edge, so their headings carry the same `px-3` while
                    the address column's sits flush like the address does. */}
                <div
                  className={cn(
                    "hidden items-end gap-4 border-b px-6 pb-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase md:grid",
                    COLUMNS,
                  )}
                >
                  <span>Account</span>
                  <span className="px-3">Your name</span>
                  <span className="px-3">Where you&rsquo;re from</span>
                  <span className="px-3">Favourite vacation (hot or cold?)</span>
                  <span className="sr-only">Account details</span>
                </div>

                {/* No dividers: forty rows of rules is most of what made this
                    page feel loud. A row is bounded by its own spacing, and
                    the tint on a taken row is what the eye follows instead —
                    which is why the rows are spaced apart rather than merely
                    stacked: a run of taken rows with no gap fuses into one
                    block, and the room can no longer count them. */}
                <ul className="space-y-1 p-3">
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

          <motion.p variants={riseChild} className="text-xs leading-relaxed text-muted-foreground">
            {/* No "you'll be asked to change your password": the accounts are
                created without a forced reset on purpose, so the one password
                keeps working across every cloud this event uses. */}
            The Google Workspace password works as-is &mdash; there is nothing to change and nothing to enrol.
            {hasAccessPass && (
              <>
                {" "}
                On the Azure sign-in screen you may need to choose &ldquo;Use your Temporary Access Pass&rdquo; before it asks for
                the pass.
              </>
            )}
            {hasAwsPassword && (
              <>
                {" "}
                AWS is the exception: it has its own password in your row&rsquo;s details, and your email address is the IAM
                user name.
              </>
            )}{" "}
            These accounts and everything in them are deleted when the {data.mode} ends.
          </motion.p>
        </>
      )}
    </motion.div>
  );
}

/**
 * One account: the address and the three answers, with everything else a click
 * away.
 *
 * The row is what the room reads across — who is on which account, and where
 * they are from — so it carries only that. Passwords are the opposite: needed
 * once, at sign-in, by one person, and a wall of them across every row is what
 * made this table hard to scan. They live in the details panel below, open one
 * row at a time.
 */
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
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  return (
    // The tint is inset and rounded rather than full-bleed: with the dividers
    // gone it is the only thing marking one row off from the next, and a band
    // running wall to wall reads as another rule.
    <li className={cn("rounded-lg px-3 py-3 transition-colors", filled ? "bg-muted/40" : "hover:bg-accent/25")}>
      <div className={cn("gap-4 md:grid md:items-center", COLUMNS)}>
        <Credential value={account.email} label="email" />

        <Field
          label="Your name"
          value={values.name}
          maxLength={CLAIM_LIMITS.name}
          onChange={(v) => onEdit("name", v)}
          onFocus={() => onFocus("name")}
          onBlur={() => onBlur("name")}
          className="mt-3 md:mt-0"
        />
        <Field
          label="Where you're from"
          value={values.from}
          maxLength={CLAIM_LIMITS.from}
          onChange={(v) => onEdit("from", v)}
          onFocus={() => onFocus("from")}
          onBlur={() => onBlur("from")}
        />
        <Field
          label="Favourite vacation"
          value={values.vacation}
          maxLength={CLAIM_LIMITS.vacation}
          onChange={(v) => onEdit("vacation", v)}
          onFocus={() => onFocus("vacation")}
          onBlur={() => onBlur("vacation")}
        />

        <div className="mt-3 md:mt-0 md:text-right">
          {/* Ghost, not outline: one outlined button per row is forty outlines
              down the page, competing with the inputs that are the point. */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground md:w-auto"
            onClick={() => setOpen((on) => !on)}
            aria-expanded={open}
            aria-controls={detailsId}
          >
            Details
            <ChevronDown className={cn("transition-transform duration-200", open && "rotate-180")} />
          </Button>
        </div>
      </div>

      {/* Kept in the DOM while closed so the copy buttons and the link are
          there for anyone searching the page, and so opening a row costs
          nothing. */}
      <div id={detailsId} hidden={!open} className="mt-4">
        <AccountDetails account={account} />
      </div>
    </li>
  );
}

/**
 * Everything about an account that is not on its row: what to sign in with,
 * and — on a challenge — where this competitor's own environment is. The
 * address is not repeated here; it is on the row, with its own copy button.
 */
function AccountDetails({ account }: { account: Row }) {
  // Labelled as expired rather than hidden once it lapses: an attendee who
  // cannot sign in needs to know which credential went stale, not to find the
  // row it used to be on.
  const expired = accessPassExpired(account);

  return (
    <div className="grid gap-4 rounded-lg bg-muted/50 p-4 sm:grid-cols-2">
      {/* Named for the directory it belongs to, not just "password". An event
          hands out two secrets that look alike, and an attendee staring at a
          sign-in box needs to know which box this one is for — Harness has no
          password of its own, it is entered through Sign in with Google. */}
      <Detail label="Google Password">
        <Credential value={account.tempPassword} label="Google password" />
      </Detail>
      {/* Azure asks for this instead of the password — see the note under the
          table. Only an event that provisioned Azure has one. */}
      {account.azureAccessPass && (
        <Detail label={`Azure Password${expired ? " (expired)" : ""}`}>
          <Credential value={account.azureAccessPass} label="Azure pass" />
        </Detail>
      )}
      {/* AWS is the one cloud that does not take the Google password: its IAM
          user carries an AWS-generated one. The sign-in name is the same email
          as everywhere else, so the password is all that needs saying. */}
      {account.awsPassword && (
        <Detail label="AWS Password" hint="Sign in with your email address as the IAM user name.">
          <Credential value={account.awsPassword} label="AWS password" />
        </Detail>
      )}
      {/* One per attendee on every event, whatever clouds it picked — this is
          where the actual work happens, so it sits with the credentials rather
          than with the org link at the top of the page. */}
      {account.harnessProjectUrl && (
        <Detail label="Your Harness project">
          <LinkButton href={account.harnessProjectUrl}>Open project</LinkButton>
        </Detail>
      )}
      {/* This competitor's own environment, on a challenge — their project,
          their resource group, their AWS account. A workshop shares one per
          cloud and links to it once above the table, so its rows have none. */}
      {account.links.length > 0 && (
        <Detail label="Your environment">
          <div className="flex flex-wrap gap-2">
            {account.links.map((link) => (
              <CloudButton key={link.cloud} link={link} />
            ))}
          </div>
        </Detail>
      )}
    </div>
  );
}

/** One labelled thing inside a row's details panel. */
function Detail({
  label,
  hint,
  children,
}: {
  label: string;
  /** What this credential is actually for, when the label alone won't say. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="block text-xs font-medium text-foreground">{label}</span>
      {hint && <span className="mt-0.5 mb-1.5 block text-xs text-muted-foreground">{hint}</span>}
      <div className={cn(!hint && "mt-1.5")}>{children}</div>
    </div>
  );
}

/** Whether this account's Azure access pass has already lapsed. */
function accessPassExpired(account: Row): boolean {
  const at = account.azureAccessPassExpiresAt;
  return at ? new Date(at).getTime() <= Date.now() : false;
}

/** One credential, with the copy button attendees will actually need. */
function Credential({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-start gap-1.5">
      {/* Wrapped rather than truncated: an attendee has to be able to read the
          whole value to type it into a sign-in box, and generated addresses
          run longer than any column width worth giving them. */}
      <span className="min-w-0 font-mono text-sm break-all">{value}</span>
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
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/**
 * One shared answer input, with the label that only shows when stacked.
 *
 * No placeholder: the column heading above it (or the inline label, stacked)
 * already says what goes in, and a grid of grey example answers reads as a
 * grid of already-filled rows at a glance.
 */
function Field({
  label,
  value,
  maxLength,
  onChange,
  onFocus,
  onBlur,
  className,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs text-muted-foreground md:hidden">{label}</span>
      {/* Borderless at rest, outlined on hover and while being typed in. Ten
          rows of three outlined boxes is thirty rectangles down the page; the
          field's own background is enough to say "you can type here", and the
          border earns its place only on the one field being used. It is made
          transparent rather than removed so nothing shifts when it appears. */}
      <Input
        className="border-transparent shadow-none hover:border-input focus:border-input"
        value={value}
        maxLength={maxLength}
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
  const pending = status === "scheduled" || status === "requested" || status === "provisioning" || status === "applying";
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
        {pending && status !== "scheduled" && <Loader2 className="size-4 shrink-0 animate-spin" />}
        {message}
      </CardContent>
    </Card>
  );
}
