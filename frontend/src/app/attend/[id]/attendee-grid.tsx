"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Loader2, UserCheck } from "lucide-react";
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
 * been through JSON on a poll. It is only ever read as "is this row taken", so
 * the union is the honest type rather than a lie in one direction.
 */
type Row = Omit<AttendeeView["accounts"][number], "claimedAt"> & {
  claimedAt: string | Date | null;
};
type View = Omit<AttendeeView, "accounts"> & { accounts: Row[] };

type Draft = { name: string; from: string; vacation: string };
const EMPTY_DRAFT: Draft = { name: "", from: "", vacation: "" };

/** Statuses where accounts are still on their way. */
const PENDING = new Set<RunStatus>([
  "scheduled",
  "requested",
  "provisioning",
  "applying",
]);

const CLAIM_ERRORS: Record<string, string> = {
  already_claimed: "Someone just took this one — pick another row.",
  not_found: "That account is no longer part of this event.",
  invalid: "Check your answers and try again.",
};

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
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [failure, setFailure] = useState<{ id: number; message: string } | null>(
    null,
  );
  /** The row claimed from this browser, highlighted for the rest of the visit. */
  const [mine, setMine] = useState<number | null>(null);
  const claiming = useRef(false);

  const refresh = useCallback(async () => {
    // A poll landing mid-claim would roll the row back to unclaimed for a
    // frame; the claim response is the newer truth, so let it win.
    if (claiming.current) return;
    const res = await fetch(`/api/attend/${runId}`, { cache: "no-store" });
    if (!res.ok) return;
    setData(await res.json());
  }, [runId]);

  const unclaimed = data.accounts.some((a) => !a.claimedAt);
  // Keep the page live while the room is still filling in, then stop: a
  // finished event has nothing left to poll for.
  const live = PENDING.has(data.status) || unclaimed;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [live, refresh]);

  function edit(id: number, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...EMPTY_DRAFT, ...prev[id], ...patch } }));
  }

  async function claim(id: number) {
    const draft = drafts[id] ?? EMPTY_DRAFT;
    if (draft.name.trim().length === 0) {
      setFailure({ id, message: "Add your name to claim this account." });
      return;
    }

    setPendingId(id);
    claiming.current = true;
    setFailure(null);
    try {
      const res = await fetch(`/api/attend/${runId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: id,
          name: draft.name.trim(),
          from: draft.from.trim(),
          vacation: draft.vacation.trim(),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          CLAIM_ERRORS[body?.error] ?? `Could not claim this account (${res.status})`,
        );
      }

      setData((prev) => ({
        ...prev,
        accounts: prev.accounts.map((a) => (a.id === id ? body.account : a)),
      }));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setMine(id);
    } catch (err) {
      setFailure({
        id,
        message: err instanceof Error ? err.message : "Could not claim this account",
      });
      // Someone else's name may have landed on this row; show the room's
      // current state rather than leaving a stale form open.
      claiming.current = false;
      void refresh();
    } finally {
      claiming.current = false;
      setPendingId(null);
    }
  }

  const claimedCount = data.accounts.filter((a) => a.claimedAt).length;
  const noun = data.mode === "challenge" ? "competitor" : "attendee";

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
            ? `Find a free row, put your name on it, and sign in with those credentials. ${claimedCount} of ${data.accounts.length} claimed.`
            : `Accounts for this ${data.mode} will appear here.`}
        </p>
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
                  <span className="sr-only">Claim</span>
                </div>

                <ul className="divide-y">
                  {data.accounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      draft={drafts[account.id] ?? EMPTY_DRAFT}
                      pending={pendingId === account.id}
                      disabled={pendingId !== null && pendingId !== account.id}
                      isMine={mine === account.id}
                      error={failure?.id === account.id ? failure.message : null}
                      onEdit={(patch) => edit(account.id, patch)}
                      onClaim={() => void claim(account.id)}
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
            You&rsquo;ll be asked to choose a new password the first time you
            sign in. These accounts and everything in them are deleted when the{" "}
            {data.mode} ends.
          </motion.p>
        </>
      )}
    </motion.div>
  );
}

function AccountRow({
  account,
  draft,
  pending,
  disabled,
  isMine,
  error,
  onEdit,
  onClaim,
}: {
  account: Row;
  draft: Draft;
  pending: boolean;
  /** Another row is mid-claim; hold this one still until that settles. */
  disabled: boolean;
  isMine: boolean;
  error: string | null;
  onEdit: (patch: Partial<Draft>) => void;
  onClaim: () => void;
}) {
  const claimed = Boolean(account.claimedAt);

  return (
    <li
      className={cn(
        "gap-4 px-6 py-4 transition-colors md:grid md:items-center",
        COLUMNS,
        claimed ? "bg-muted/30" : "hover:bg-accent/20",
        isMine && "bg-brand/8 hover:bg-brand/8",
      )}
    >
      <div className="min-w-0">
        <Credential value={account.email} label="email" />
        <Credential value={account.tempPassword} label="password" muted />
      </div>

      {claimed ? (
        <>
          <Answer label="Name" className="mt-3 md:mt-0">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <UserCheck className="size-3.5 shrink-0 text-brand" />
              {account.claimedName}
            </span>
          </Answer>
          <Answer label="Where you're from">{account.claimedFrom}</Answer>
          <Answer label="Favourite vacation">{account.claimedVacation}</Answer>
          <span className="mt-2 block text-xs text-muted-foreground md:mt-0 md:text-right">
            {isMine ? "You" : "Claimed"}
          </span>
        </>
      ) : (
        <>
          <Field
            label="Your name"
            value={draft.name}
            maxLength={CLAIM_LIMITS.name}
            placeholder="Your name"
            disabled={disabled || pending}
            onChange={(v) => onEdit({ name: v })}
            onEnter={onClaim}
            className="mt-3 md:mt-0"
          />
          <Field
            label="Where you're from"
            value={draft.from}
            maxLength={CLAIM_LIMITS.from}
            placeholder="Chicago"
            disabled={disabled || pending}
            onChange={(v) => onEdit({ from: v })}
            onEnter={onClaim}
          />
          <Field
            label="Favourite vacation"
            value={draft.vacation}
            maxLength={CLAIM_LIMITS.vacation}
            placeholder="Two weeks in Lisbon"
            disabled={disabled || pending}
            onChange={(v) => onEdit({ vacation: v })}
            onEnter={onClaim}
          />
          <div className="mt-3 md:mt-0">
            <Button
              variant="brand"
              size="sm"
              className="w-full md:w-auto"
              disabled={disabled || pending}
              onClick={onClaim}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? "Claiming…" : "Claim"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className="mt-2 text-sm text-destructive md:col-span-5">{error}</p>
      )}
    </li>
  );
}

/** An email or password, with the copy button attendees will actually need. */
function Credential({
  value,
  label,
  muted = false,
}: {
  value: string;
  label: string;
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

/** One claim input, with the label that only shows on the stacked layout. */
function Field({
  label,
  value,
  maxLength,
  placeholder,
  disabled,
  onChange,
  onEnter,
  className,
}: {
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
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
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        // The row is a set of sibling inputs rather than a form, so Enter has
        // to be wired up by hand — attendees will press it.
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter();
        }}
      />
    </label>
  );
}

/** A submitted answer, with the same stacked-layout label as `Field`. */
function Answer({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 text-sm", className)}>
      <span className="mb-0.5 block text-xs text-muted-foreground md:hidden">
        {label}
      </span>
      {/* Wrapped, not clipped — a long answer is the interesting one. */}
      <span className="block wrap-break-word">
        {children || <span className="text-muted-foreground">—</span>}
      </span>
    </div>
  );
}

/** Shown when the event has no accounts yet — or no longer has any. */
function EmptyState({ status, noun }: { status: RunStatus; noun: string }) {
  const message =
    status === "scheduled"
      ? "This event hasn't started yet. Accounts appear here automatically once it's provisioned."
      : PENDING.has(status)
        ? `Accounts are being created right now. This page updates itself — no need to reload.`
        : status === "failed"
          ? "This event didn't finish setting up. Check with your organizer."
          : `This event has ended and its ${noun} accounts have been deleted.`;

  return (
    <Card>
      <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
        {PENDING.has(status) && status !== "scheduled" && (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        )}
        {message}
      </CardContent>
    </Card>
  );
}
