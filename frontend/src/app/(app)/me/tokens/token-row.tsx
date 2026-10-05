"use client";

/** One saved token: its header and actions, and everything under it once opened. */

import { Fragment, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Layers, Loader2, RefreshCw, Rocket, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeployReport } from "@/lib/harness-deploy";
import type { DeployChoices } from "@/lib/harness-deploy-choices";
import type { DeployedContent, DeploySelection } from "@/lib/harness-deploy-selection";
import { permissionLabel } from "@/lib/harness-permissions";
import type { ScrubRun } from "@/lib/harness-scrub";
import type { HarnessTokenSummary } from "@/lib/harness-tokens";
import { cn } from "@/lib/utils";
import { DeployForm, useDeployForm } from "./deploy-form";
import { DeployReportPanel } from "./deploy-report-panel";
import { DeployedCredentials } from "./deployed-credentials";
import { shortDate, stamp, tokenName } from "./format";

const PRINCIPAL_LABEL: Partial<Record<string, string>> = {
  USER: "Personal token",
  SERVICE_ACCOUNT: "Service account",
};

/** Which of the row's actions is running, if any. */
export type RowBusy = { row: boolean; deploying: boolean; scrubbing: boolean };

export function TokenRow({
  token,
  choices,
  busy,
  canDeploy,
  scrubDays,
  expanded,
  onToggle,
  onRecheck,
  onRemove,
  onDeploy,
  onScrub,
}: {
  token: HarnessTokenSummary;
  choices: DeployChoices;
  busy: RowBusy;
  canDeploy: boolean;
  scrubDays: number;
  expanded: boolean;
  onToggle: () => void;
  onRecheck: () => void;
  onRemove: () => void;
  onDeploy: (org: string, selection: DeploySelection) => Promise<DeployReport | null>;
  onScrub: () => Promise<ScrubRun | null>;
}) {
  const name = tokenName(token);
  const form = useDeployForm(token, choices, busy.deploying, onDeploy);
  const [scrubbed, setScrubbed] = useState<ScrubRun | null>(null);
  const locked = busy.row || busy.deploying;

  // Anything under the row shares its padding, so the row itself keeps the
  // whole cell to click on when there is nothing below it.
  const hasBody = expanded || form.open || form.report !== null;

  return (
    <article aria-label={name}>
      <div
        className={cn("group/row relative px-5 transition-colors hover:bg-muted/30", hasBody ? "pb-2 pt-4" : "py-4")}
      >
        {/* Sits under the row so every part of the cell toggles it, including
            the padding — the buttons above take their own clicks back. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide the details for ${name}` : `Show everything about ${name}`}
          className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        />

        <div className="pointer-events-none relative flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/row:text-foreground" />
          )}
          <h3 className="min-w-0 truncate font-medium">{name}</h3>
          {token.accountName !== null && (
            <code className="truncate rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">
              {token.accountId}
            </code>
          )}
          {!token.usable && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-destructive">
              <AlertTriangle className="size-3.5" />
              can&apos;t be decrypted — paste it again
            </span>
          )}

          <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1">
            {canDeploy && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={locked || !token.usable}
                onClick={() => form.setOpen((open) => !open)}
                title="Create a Harness org and pick what to fill it with"
              >
                {busy.deploying ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                Deploy content
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={locked || !token.usable}
              onClick={onRecheck}
              title="Ask Harness about this token again"
            >
              {busy.row ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Re-check
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove the token for ${name}`}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              disabled={locked}
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {hasBody && (
        <div className="space-y-2 px-5 pb-4">
          {form.open && (
            <DeployForm form={form} token={token} choices={choices} deploying={busy.deploying} scrubDays={scrubDays} />
          )}
          {form.report && <DeployReportPanel report={form.report} onClose={form.dismissReport} />}
          {expanded && (
            <TokenDetails
              token={token}
              busy={busy}
              scrubbed={scrubbed}
              onScrub={async () => setScrubbed(await onScrub())}
              onDismissScrub={() => setScrubbed(null)}
            />
          )}
        </div>
      )}
    </article>
  );
}

/** Who the token is, where it last deployed, its scrub state and its permissions. */
function TokenDetails({
  token,
  busy,
  scrubbed,
  onScrub,
  onDismissScrub,
}: {
  token: HarnessTokenSummary;
  busy: RowBusy;
  scrubbed: ScrubRun | null;
  onScrub: () => void;
  onDismissScrub: () => void;
}) {
  const identity = [
    PRINCIPAL_LABEL[token.principalType ?? ""] ?? (token.kind === "sat" ? "Service account" : "Personal token"),
    token.accountName === null ? <code key="account" className="font-mono">{token.accountId}</code> : null,
    token.principal,
    <code key="tail" className="font-mono">…{token.tail}</code>,
    token.verifiedAt ? `verified ${shortDate(token.verifiedAt)}` : "not currently valid",
  ].filter(Boolean);

  return (
    <div className="ml-1.5 space-y-2 border-l pl-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {identity.map((part, i) => (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden>·</span>}
            {part}
          </Fragment>
        ))}
      </p>

      {token.lastDeploy ? (
        <>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Rocket className="size-3.5 shrink-0" />
            <span>
              Deployed to{" "}
              <a
                href={token.lastDeploy.orgUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground hover:underline"
              >
                {token.lastDeploy.orgName}
              </a>
            </span>
            {token.lastDeploy.orgIdentifier !== token.lastDeploy.orgName && (
              <code className="rounded bg-muted px-1 py-0.5 font-mono">{token.lastDeploy.orgIdentifier}</code>
            )}
            <span aria-hidden>·</span>
            <time dateTime={token.lastDeploy.at}>{stamp(token.lastDeploy.at)}</time>
          </p>

          <DeployedContentLine content={token.lastDeploy.content} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Never deployed with.</p>
      )}

      <DeployedCredentials
        scrub={token.scrub}
        scrubbing={busy.scrubbing}
        disabled={busy.row || busy.deploying || !token.usable}
        run={scrubbed}
        onScrub={onScrub}
        onDismiss={onDismissScrub}
      />

      <PermissionList permissions={token.permissions} />
    </div>
  );
}

/** What the last deploy put into the organization, as far as it was recorded. */
function DeployedContentLine({ content }: { content: DeployedContent | null }) {
  if (content === null) {
    return (
      <p className="text-xs text-muted-foreground">That deploy ran before this site kept a record of what went in.</p>
    );
  }

  const parts = [
    ...(content.official ? ["Official content"] : []),
    ...(content.mySecrets ? ["My secrets"] : []),
    ...content.myTemplates,
  ];

  if (parts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing landed in that organization — every ticked source was skipped.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <Layers className="size-3.5 shrink-0" />
      <span>Holding</span>
      {parts.map((part) => (
        <span key={part} className="rounded-full bg-muted px-1.5 py-0.5 text-foreground">
          {part}
        </span>
      ))}
    </div>
  );
}

function PermissionList({ permissions }: { permissions: HarnessTokenSummary["permissions"] }) {
  const granted = permissions.filter((p) => p.permitted).length;

  return (
    <div className="space-y-1 pt-0.5">
      <p className="text-xs text-muted-foreground">
        {permissions.length === 0
          ? "No permission check recorded"
          : `${granted} of ${permissions.length} checked permissions granted`}
      </p>
      <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {permissions.map((p) => (
          <li
            key={`${p.resourceType}:${p.permission}`}
            className={cn("flex items-center gap-1.5", p.permitted ? "text-foreground" : "text-muted-foreground")}
          >
            {p.permitted ? <Check className="size-3.5 shrink-0 text-brand" /> : <X className="size-3.5 shrink-0" />}
            {permissionLabel(p.permission)}
          </li>
        ))}
        {permissions.length === 0 && (
          <li className="text-muted-foreground">Harness did not answer the permission check for this token.</li>
        )}
      </ul>
    </div>
  );
}
