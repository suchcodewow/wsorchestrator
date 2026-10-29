/** The public API reference: how to authenticate, and every endpoint. */

import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";
import { MAX_TOKENS_PER_USER } from "@/db/schema";
import {
  ACCESS_LABELS,
  GROUPS,
  endpointAnchor,
  type Endpoint,
  type Field,
  type Method,
} from "@/lib/api-reference";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "API reference — Harness Events",
  description:
    "Every Harness Events API endpoint, who may call it, and how to call it with a personal access token.",
};

const METHOD_TINT: Record<Method, string> = {
  GET: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  POST: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  PUT: "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  PATCH: "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  DELETE: "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300",
};

/** Where this deployment answers, so the examples work when pasted. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "harnessevents.io";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem]">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border bg-card/70 px-4 py-3 font-mono text-[0.8125rem] leading-[1.65] backdrop-blur-sm">
      {children}
    </pre>
  );
}

/** Catalog prose, with `backticks` as inline code. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(`[^`]+`)/)
        .map((part, i) =>
          part.startsWith("`") && part.endsWith("`") ? (
            <Code key={i}>{part.slice(1, -1)}</Code>
          ) : (
            part
          ),
        )}
    </>
  );
}

function PathText({ path }: { path: string }) {
  return (
    <>
      {path.split(/(\{[^}]+\})/).map((part, i) =>
        part.startsWith("{") ? (
          <span key={i} className="text-brand">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function MethodPill({ method }: { method: Method }) {
  return (
    <span
      className={cn(
        "inline-flex w-16 shrink-0 justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1",
        METHOD_TINT[method],
      )}
    >
      {method}
    </span>
  );
}

/**
 * Three columns are too many for a phone, so below `sm` each row becomes a
 * wrapping line: the first two cells side by side, the last on its own line.
 */
const STACKED_TABLE = "w-full text-sm max-sm:block max-sm:[&>tbody]:block";
const STACKED_ROW =
  "align-top max-sm:flex max-sm:flex-wrap max-sm:gap-x-3 max-sm:py-1.5";

function FieldTable({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      <table className={`mt-1.5 ${STACKED_TABLE}`}>
        <tbody className="divide-y divide-border/60">
          {fields.map((f, i) => (
            <tr key={i} className={STACKED_ROW}>
              <td className="font-mono text-[0.8125rem] sm:py-1.5 sm:pr-3 sm:whitespace-nowrap">
                {f.name}
                {f.required && <span className="text-brand">*</span>}
              </td>
              <td className="min-w-0 font-mono text-[0.8125rem] break-words text-muted-foreground sm:min-w-44 sm:py-1.5 sm:pr-3">
                {f.type}
              </td>
              <td className="text-muted-foreground max-sm:basis-full sm:w-full sm:py-1.5">
                {f.note && <Prose text={f.note} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointCard({ e }: { e: Endpoint }) {
  const anchor = endpointAnchor(e);
  return (
    <article
      id={anchor}
      className="scroll-mt-20 rounded-2xl border bg-card/60 p-5 backdrop-blur-sm dark:bg-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MethodPill method={e.method} />
        <a
          href={`#${anchor}`}
          className="min-w-0 font-mono text-sm font-medium break-all hover:underline"
        >
          <PathText path={e.path} />
        </a>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {ACCESS_LABELS[e.access]}
          </span>
          {!e.token && e.access !== "internal" && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300">
              Browser session only
            </span>
          )}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed">
        <Prose text={e.summary} />
      </p>
      {e.notes && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          <Prose text={e.notes} />
        </p>
      )}

      <div className="mt-4 space-y-4">
        {e.params && e.params.length > 0 && (
          <FieldTable title="Path" fields={e.params} />
        )}
        {e.query && e.query.length > 0 && (
          <FieldTable title="Query" fields={e.query} />
        )}
        {e.body && e.body.fields.length > 0 && (
          <FieldTable
            title={
              e.body.kind === "multipart"
                ? "Form data (multipart)"
                : "JSON body"
            }
            fields={e.body.fields}
          />
        )}

        <div>
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Returns
          </h4>
          <p className="mt-1.5 font-mono text-[0.8125rem] leading-relaxed break-words">
            {e.returns.replaceAll("`", "")}
          </p>
        </div>

        {e.errors && e.errors.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Errors
            </h4>
            <div className="mt-1.5">
              <table className={STACKED_TABLE}>
                <tbody className="divide-y divide-border/60">
                  {e.errors.map((err, i) => (
                    <tr key={i} className={STACKED_ROW}>
                      <td className="font-mono text-[0.8125rem] sm:py-1.5 sm:pr-3">
                        {err.status}
                      </td>
                      <td className="font-mono text-[0.8125rem] break-all text-muted-foreground sm:py-1.5 sm:pr-3 sm:break-normal sm:whitespace-nowrap">
                        {err.error}
                      </td>
                      <td className="text-muted-foreground max-sm:basis-full sm:w-full sm:py-1.5">
                        <Prose text={err.when} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export default async function ApiReferencePage() {
  const session = await auth();
  const base = await origin();
  const endpoints = GROUPS.flatMap((g) => g.endpoints);
  const sessionOnly = endpoints.filter(
    (e) => !e.token && e.access !== "internal",
  );
  const tokenCount = endpoints.filter(
    (e) => e.token && e.access !== "internal",
  ).length;

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />
      <SiteHeader session={session} />

      <main className="mx-auto grid max-w-6xl gap-10 px-6 pt-12 pb-24 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {[
              { id: "authentication", title: "Authentication" },
              { id: "errors", title: "Errors" },
              { id: "session-only", title: "Session-only routes" },
            ].map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {s.title}
                </a>
              </li>
            ))}
            <li className="pt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Endpoints
            </li>
            {GROUPS.map((g) => (
              <li key={g.id}>
                <a
                  href={`#${g.id}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {g.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-16">
          <header>
            <h1 className="text-4xl font-medium tracking-tight">
              API reference
            </h1>
            <p className="mt-3 text-base text-muted-foreground">
              {tokenCount} endpoints take a personal access token;{" "}
              {sessionOnly.length} need a browser session.
            </p>
          </header>

          <section id="authentication" className="scroll-mt-20 space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">
              Authentication
            </h2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
              <li>
                Create a token on{" "}
                <Link
                  href="/me/api-tokens"
                  className="text-brand hover:underline"
                >
                  My settings → My API tokens
                </Link>
                . It is shown once.
              </li>
              <li>
                Send it as <Code>Authorization: Bearer wo_…</Code>. A token
                does not expire, and each account can hold{" "}
                {MAX_TOKENS_PER_USER} active ones. Revoking one, or deleting
                the account, takes effect on the next request.
              </li>
              <li>
                A token has no scopes. It acts as you, with the roles you have
                at the moment of each request, so a role change applies to your
                tokens at once.
              </li>
              <li>
                A request that carries both a session cookie and a token is
                treated as the session.
              </li>
              <li>
                Bodies are JSON unless an endpoint says form data. Times are ISO
                8601 in UTC.
              </li>
            </ul>
            <Pre>{`export TOKEN="wo_..."
curl -H "Authorization: Bearer $TOKEN" ${base}/api/me
curl -H "Authorization: Bearer $TOKEN" "${base}/api/runs/calendar?scope=all"
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"themePreference":"dark"}' ${base}/api/me`}</Pre>
          </section>

          <section id="errors" className="scroll-mt-20 space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Errors</h2>
            <div>
              <table className={STACKED_TABLE}>
                <tbody className="divide-y divide-border/60">
                  {[
                    [
                      "400",
                      `{"error":"…"}`,
                      "The body or query failed validation. The code, and often a message, says which part.",
                    ],
                    [
                      "401",
                      `{"error":"unauthorized"}`,
                      "No session, or the token is missing, revoked, expired or malformed.",
                    ],
                    [
                      "403",
                      `{"error":"forbidden"}`,
                      "Your roles do not allow the request.",
                    ],
                    [
                      "404",
                      `{"error":"not_found"}`,
                      "No such thing, or it is not yours to see. Several endpoints answer 404 rather than 403 so as not to confirm that something exists.",
                    ],
                  ].map(([status, body, when]) => (
                    <tr key={status} className={STACKED_ROW}>
                      <td className="font-mono text-[0.8125rem] sm:py-2 sm:pr-4">
                        {status}
                      </td>
                      <td className="font-mono text-[0.8125rem] whitespace-nowrap text-muted-foreground sm:py-2 sm:pr-4">
                        {body}
                      </td>
                      <td className="text-muted-foreground max-sm:basis-full sm:w-full sm:py-2">
                        {when}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Every error is JSON with an <Code>error</Code> code. Each endpoint
              below lists the ones it can return beyond 401 and 403.
            </p>
          </section>

          <section id="session-only" className="scroll-mt-20 space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">
              Session-only routes
            </h2>
            <p className="text-sm leading-relaxed">
              These refuse a token with 401 even when its owner could make the
              same request in a browser. Each one either acts on every account
              at once or could be used to raise its own access: SQL, backups,
              roles and invites, sign-in domains, and minting tokens.
            </p>
            <ul className="space-y-1.5">
              {sessionOnly.map((e) => (
                <li key={endpointAnchor(e)} className="flex items-center gap-3">
                  <MethodPill method={e.method} />
                  <a
                    href={`#${endpointAnchor(e)}`}
                    className="font-mono text-sm break-all hover:underline"
                  >
                    <PathText path={e.path} />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {GROUPS.map((g) => (
            <section key={g.id} id={g.id} className="scroll-mt-20 space-y-4">
              <h2 className="text-2xl font-medium tracking-tight">{g.title}</h2>
              {g.intro && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <Prose text={g.intro} />
                </p>
              )}
              <div className="space-y-4">
                {g.endpoints.map((e) => (
                  <EndpointCard key={endpointAnchor(e)} e={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
