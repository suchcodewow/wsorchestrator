"use client";

/** The attendee page: a row per account, claimed by name. */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CLAIM_LIMITS, type Cloud, type RunStatus } from "@/db/schema";
import { writeGuideContextCookie } from "@/lib/guide-variables";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Check, ChevronDown, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AttendeeView, CloudLink } from "@/lib/attendees";

type Row = Omit<AttendeeView["accounts"][number], "claimedAt"> & {
  claimedAt: string | Date | null;
};
type View = Omit<AttendeeView, "accounts"> & { accounts: Row[] };

type Fields = { name: string; from: string; vacation: string };
type FieldName = keyof Fields;
const EMPTY: Fields = { name: "", from: "", vacation: "" };

const TERMINAL = new Set<RunStatus>(["destroyed", "failed"]);

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

const CLOUD_RESOURCE: Record<Cloud, string> = {
  gcp: "Google",
  azure: "Azure",
  aws: "AWS",
};

function CloudButton({ link, className }: { link: CloudLink; className?: string }) {
  return (
    <LinkButton href={link.url} className={className}>
      {CLOUD_RESOURCE[link.cloud]}
    </LinkButton>
  );
}

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

const SAVE_DEBOUNCE_MS = 500;

const COLUMNS = "md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]";

export function AttendeeGrid({ initial, runId }: { initial: View; runId: string }) {
  const [data, setData] = useState<View>(initial);
  const [values, setValues] = useState<Record<number, Fields>>(() => seed(initial.accounts));

  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  const focusedRef = useRef<{ id: number; field: FieldName } | null>(null);
  const dirtyRef = useRef<Set<number>>(new Set());
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

  const live = !TERMINAL.has(data.status);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [live, refresh]);

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
        if (!res.ok) return;
        if ((genRef.current[id] ?? 0) === gen) dirtyRef.current.delete(id);
      } catch {}
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
  const hasAccessPass = data.accounts.some((a) => a.azureAccessPass);
  const hasAwsPassword = data.accounts.some((a) => a.awsPassword);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={riseChild}>
        <h1 className="text-2xl font-medium tracking-tight text-balance">{data.name}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {data.accounts.length > 0
            ? `Take a row and open Details for your password — ${filledCount} of ${data.accounts.length} taken.`
            : `Accounts for this ${data.mode} will appear here.`}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href="/labs">Workshop guides</LinkButton>
          {data.harnessOrgUrl && <LinkButton href={data.harnessOrgUrl}>Open Harness organization</LinkButton>}
          {data.links.map((link) => (
            <CloudButton key={link.cloud} link={link} />
          ))}
        </div>
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

                <ul className="space-y-1 px-3 py-2">
                  {data.accounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      runId={runId}
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
            Your password works as-is
            {hasAwsPassword && <>, except on AWS, which has its own in your row&rsquo;s details</>}
            {hasAccessPass && <>, and on Azure, which asks for your access pass</>}, and these accounts are deleted when
            the {data.mode} ends.
          </motion.p>
        </>
      )}
    </motion.div>
  );
}

function AccountRow({
  account,
  runId,
  values,
  onEdit,
  onFocus,
  onBlur,
}: {
  account: Row;
  runId: string;
  values: Fields;
  onEdit: (field: FieldName, value: string) => void;
  onFocus: (field: FieldName) => void;
  onBlur: (field: FieldName) => void;
}) {
  const filled = Boolean(account.claimedAt);
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  return (
    <li className={cn("rounded-lg px-3 py-2 transition-colors", filled ? "bg-muted/40" : "hover:bg-accent/25")}>
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

      <div id={detailsId} hidden={!open} className="mt-2.5">
        <AccountDetails account={account} runId={runId} />
      </div>
    </li>
  );
}

function AccountDetails({ account, runId }: { account: Row; runId: string }) {
  const expired = accessPassExpired(account);

  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
      <Detail label="Google Password">
        <Credential value={account.tempPassword} label="Google password" />
      </Detail>
      {account.azureAccessPass && (
        <Detail label={`Azure Password${expired ? " (expired)" : ""}`}>
          <Credential value={account.azureAccessPass} label="Azure pass" />
        </Detail>
      )}
      {account.awsPassword && (
        <Detail label="AWS Password" hint="Sign in with your email address as the IAM user name.">
          <Credential value={account.awsPassword} label="AWS password" />
        </Detail>
      )}
      {account.harnessProjectUrl && (
        <Detail>
          <LinkButton href={account.harnessProjectUrl}>Your Harness Project</LinkButton>
        </Detail>
      )}
      <Detail
        label="Workshop guides"
        hint="The guides then write your own project, organization and account into their steps."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            writeGuideContextCookie({ runId, accountId: account.id, typed: {} });
            window.open("/labs", "_blank", "noreferrer");
          }}
        >
          <ExternalLink />
          Open as you
        </Button>
      </Detail>
      {account.links.length > 0 && (
        <Detail label="Your environment">
          <div className="flex flex-wrap gap-2">
            {account.links.map((link) => (
              <CloudButton key={link.cloud} link={link} />
            ))}
          </div>
        </Detail>
      )}
    </dl>
  );
}

function Detail({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-xs font-medium whitespace-nowrap text-foreground">{label}</dt>
      <dd className="min-w-0">
        {children}
        {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </>
  );
}

function accessPassExpired(account: Row): boolean {
  const at = account.azureAccessPassExpiresAt;
  return at ? new Date(at).getTime() <= Date.now() : false;
}

function Credential({ value, label }: { value: string; label: string }) {
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
      className="group -mx-2 -my-1.5 flex w-fit max-w-full cursor-pointer items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          return;
        }
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      <span className="min-w-0 font-mono text-sm break-all">{value}</span>
      <span role="status" className="sr-only">
        {copied ? "Copied" : `, click to copy ${label}`}
      </span>
      <span
        aria-hidden
        className={cn(
          "shrink-0 py-0.5 text-muted-foreground transition-opacity",
          copied
            ? "opacity-100"
            :
              "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70 [@media(hover:none)]:opacity-70",
        )}
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </span>
    </button>
  );
}

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

function EmptyState({ status, noun }: { status: RunStatus; noun: string }) {
  const pending = status === "scheduled" || status === "requested" || status === "provisioning" || status === "applying";
  const message =
    status === "scheduled"
      ? "This event hasn't started yet, so accounts will appear here later."
      : pending
        ? `Accounts are being created right now — this page updates itself.`
        : status === "failed"
          ? "This event didn't finish setting up — check with your organizer."
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
