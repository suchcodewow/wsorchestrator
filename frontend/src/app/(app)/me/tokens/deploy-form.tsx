"use client";

/** Deploy content: name a Harness organization and tick what to fill it with. */

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeployReport } from "@/lib/harness-deploy";
import type { DeployChoices } from "@/lib/harness-deploy-choices";
import { nothingSelected, type DeploySelection } from "@/lib/harness-deploy-selection";
import { harnessIdentifier } from "@/lib/harness-identifier";
import type { HarnessTokenSummary } from "@/lib/harness-tokens";
import { cn } from "@/lib/utils";
import { countOf, plural, sourceLabel } from "./format";

type Deploy = (org: string, selection: DeploySelection) => Promise<DeployReport | null>;

/**
 * The form's state, kept by the row rather than the form so that closing the
 * prompt and opening it again keeps what was typed and ticked.
 */
export function useDeployForm(token: HarnessTokenSummary, choices: DeployChoices, deploying: boolean, onDeploy: Deploy) {
  const [open, setOpen] = useState(false);
  const [org, setOrg] = useState(token.lastDeploy?.orgName ?? "");
  const [report, setReport] = useState<DeployReport | null>(null);

  // Everything the site and this account hold starts ticked, which is what a
  // deploy used to send before any of this could be chosen — bar a source whose
  // token no longer opens, since ticking that only buys a skipped step.
  const [selection, setSelection] = useState<DeploySelection>({
    official: choices.official.secrets + choices.official.sources > 0,
    mySecrets: choices.mySecrets > 0,
    myTemplates: choices.myTemplates.filter((s) => s.usable).map((s) => s.id),
  });

  const identifier = harnessIdentifier(org);
  const rerun = identifier !== null && identifier.toLowerCase() === token.lastDeploy?.orgIdentifier.toLowerCase();
  const empty = nothingSelected(selection);
  const ready = identifier !== null && !empty && !deploying;

  const select = (change: Partial<DeploySelection>) => setSelection((current) => ({ ...current, ...change }));

  const toggleTemplate = (id: string) =>
    setSelection((current) => ({
      ...current,
      myTemplates: current.myTemplates.includes(id)
        ? current.myTemplates.filter((other) => other !== id)
        : [...current.myTemplates, id],
    }));

  async function submit() {
    if (!ready) return;
    const result = await onDeploy(org, selection);
    if (!result) return;
    setOpen(false);
    setReport(result);
  }

  return {
    open,
    setOpen,
    org,
    setOrg,
    report,
    dismissReport: () => setReport(null),
    selection,
    select,
    toggleTemplate,
    identifier,
    rerun,
    empty,
    ready,
    submit,
  };
}

export type DeployFormState = ReturnType<typeof useDeployForm>;

export function DeployForm({
  form,
  token,
  choices,
  deploying,
  scrubDays,
}: {
  form: DeployFormState;
  token: HarnessTokenSummary;
  choices: DeployChoices;
  deploying: boolean;
  scrubDays: number;
}) {
  const { selection, rerun } = form;
  const secretsGoing =
    (selection.official && choices.official.secrets > 0) || (selection.mySecrets && choices.mySecrets > 0);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {rerun ? (
          <>
            Into <span className="font-medium text-foreground">{token.lastDeploy?.orgName}</span> again, leaving
            anything already there as it is.
          </>
        ) : (
          <>
            A new organization in{" "}
            <span className="font-medium text-foreground">{token.accountName ?? token.accountId}</span>, filled with
            whatever is ticked below.
          </>
        )}
      </p>

      <DeployPicker
        choices={choices}
        selection={selection}
        disabled={deploying}
        onOfficial={(official) => form.select({ official })}
        onMySecrets={(mySecrets) => form.select({ mySecrets })}
        onTemplate={form.toggleTemplate}
      />

      {secretsGoing && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The org secrets go in with their real values so the content works immediately, and{" "}
          <span className="font-medium text-foreground">
            {scrubDays === 0
              ? "are scrubbed to 123 at the next sweep"
              : `are scrubbed to 123 after ${scrubDays} day${plural(scrubDays)}`}
          </span>
          .
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={form.org}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Organization name"
          aria-label="Name for the new Harness organization"
          disabled={deploying}
          className="min-w-56 flex-1"
          onChange={(e) => form.setOrg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void form.submit();
            if (e.key === "Escape") form.setOpen(false);
          }}
        />
        <Button variant="brand" disabled={!form.ready} onClick={() => void form.submit()}>
          {deploying && <Loader2 className="size-4 animate-spin" />}
          {rerun ? "Deploy again" : "Deploy"}
        </Button>
        <Button variant="ghost" disabled={deploying} onClick={() => form.setOpen(false)}>
          Cancel
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        <DeployFormHint form={form} token={token} deploying={deploying} />
      </p>
    </div>
  );
}

/** Why Deploy is disabled, or the identifier it will create. */
function DeployFormHint({
  form,
  token,
  deploying,
}: {
  form: DeployFormState;
  token: HarnessTokenSummary;
  deploying: boolean;
}) {
  if (form.identifier === null) {
    return form.org.trim().length === 0 ? (
      <>Harness needs a name to create the organization under.</>
    ) : (
      <>That name needs a letter, digit, or underscore in it.</>
    );
  }
  if (form.empty) return <>Tick at least one thing above to deploy.</>;

  return (
    <>
      Harness identifier:{" "}
      <code className="rounded bg-muted px-1 py-0.5 font-mono">
        {form.rerun ? token.lastDeploy?.orgIdentifier : form.identifier}
      </code>
      {deploying && <> — this runs one call per entity, so give it a minute.</>}
    </>
  );
}

/** What to deploy: the site's content, this account's secrets, its templates. */
function DeployPicker({
  choices,
  selection,
  disabled,
  onOfficial,
  onMySecrets,
  onTemplate,
}: {
  choices: DeployChoices;
  selection: DeploySelection;
  disabled: boolean;
  onOfficial: (on: boolean) => void;
  onMySecrets: (on: boolean) => void;
  onTemplate: (id: string) => void;
}) {
  const { official } = choices;
  const nothingOfficial = official.secrets + official.sources === 0;

  return (
    <fieldset className="min-w-0 space-y-0.5 rounded-lg border bg-background/60 p-1.5">
      <legend className="sr-only">What to deploy</legend>
      <Tick
        label="Official content"
        hint={
          nothingOfficial ? (
            <>This site holds no org secrets or template sources of its own.</>
          ) : (
            <>
              {countOf(official.secrets, "org secret")} and everything in{" "}
              {countOf(official.sources, "template source")} this site holds.
            </>
          )
        }
        checked={selection.official}
        disabled={disabled || nothingOfficial}
        onChange={onOfficial}
      />

      <Tick
        label="My secrets"
        hint={
          choices.mySecrets === 0 ? (
            <>You keep no org secrets of your own — add them in My settings → My org secrets.</>
          ) : (
            <>
              {countOf(choices.mySecrets, "org secret")} of your own, written into the organization. One named the
              same as an official secret wins.
            </>
          )
        }
        checked={selection.mySecrets}
        disabled={disabled || choices.mySecrets === 0}
        onChange={onMySecrets}
      />

      {choices.myTemplates.length === 0 ? (
        <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          You keep no template sources of your own — add one in My settings → My templates to copy an
          organization&apos;s content in.
        </p>
      ) : (
        <>
          <p className="px-2 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            My templates
          </p>
          {choices.myTemplates.map((source) => (
            <Tick
              key={source.id}
              label={sourceLabel(source)}
              hint={
                source.usable ? (
                  <>
                    Copy every connector, template, environment, infrastructure, policy, policy set, and filter from{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">
                      {source.projectIdentifier === null
                        ? source.orgIdentifier
                        : `${source.orgIdentifier}/${source.projectIdentifier}`}
                    </code>{" "}
                    in {source.accountName ?? source.accountId}.
                  </>
                ) : (
                  <>Its token can no longer be decrypted — re-add it in My settings → My templates.</>
                )
              }
              checked={selection.myTemplates.includes(source.id)}
              disabled={disabled}
              onChange={() => onTemplate(source.id)}
            />
          ))}
        </>
      )}
    </fieldset>
  );
}

/** One tick, with a sentence under it saying what it stands for. */
function Tick({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-xs",
        disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-brand"
      />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
