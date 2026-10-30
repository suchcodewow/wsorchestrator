"use client";

/**
 * The Code Lab: a pretend change to a pretend shop's home page, from ticket to
 * merge, for someone who has never written code. Make a branch; edit the page
 * on the left and see it change on the right, with each of the ticket's asks
 * pointing at the code it changes; review the diff and commit it;
 * push; open a pull request; watch the checks pass and a reviewer approve; and
 * merge. Every step shows the git command it stands for. Nothing leaves the
 * browser and nothing is kept: reloading the page starts again.
 */

import "./code-lab.css";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CloudUpload,
  Code,
  Eye,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Loader2,
  RotateCcw,
  Ticket,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { diffStats, lineDiff } from "@/lib/mimir/code-lab/diff";
import { FILE, REPO, START_CODE, SUGGESTED_BRANCH, TASKS, TICKET, cleanBranchName, fakeHash, pageHtml } from "@/lib/mimir/code-lab/scenario";
import { cn } from "@/lib/utils";
import { CodeEditor } from "./code-editor";
import { DiffView } from "./diff-view";
import { HistoryGraph } from "./history-graph";
import { PR_NUMBER, PullRequestPage, type Commit } from "./pull-request";

type Stage = "branch" | "edit" | "commit" | "push" | "pr" | "review" | "merged";
const ORDER: Stage[] = ["branch", "edit", "commit", "push", "pr", "review", "merged"];

/** The stepper along the top. Hidden for now; the boxes say where you are. */
const SHOW_STEPPER = false;

const STEPS: { label: string; Icon: LucideIcon; stages: Stage[] }[] = [
  { label: "Branch", Icon: GitBranch, stages: ["branch"] },
  { label: "Edit", Icon: Code, stages: ["edit"] },
  { label: "Commit", Icon: GitCommitHorizontal, stages: ["commit"] },
  { label: "Push", Icon: CloudUpload, stages: ["push"] },
  { label: "Pull request", Icon: GitPullRequest, stages: ["pr"] },
  { label: "Review & merge", Icon: GitMerge, stages: ["review", "merged"] },
];

/** A command in the "behind the scenes" terminal, and what git would print. */
type LogLine = { cmd: string; out?: string };

const MAIN_HASH = fakeHash(START_CODE);

export function CodeLabView({ author }: { author: string }) {
  const [stage, setStage] = useState<Stage>("branch");
  const [branchInput, setBranchInput] = useState(SUGGESTED_BRANCH);
  const [branch, setBranch] = useState<string | null>(null);
  const [code, setCode] = useState(START_CODE);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [pushed, setPushed] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [pr, setPr] = useState<{ title: string; body: string } | null>(null);

  const committed = commits.at(-1)?.code ?? START_CODE;
  const say = (...lines: LogLine[]) => setLog((l) => [...l, ...lines]);

  const restart = () => {
    setStage("branch");
    setBranchInput(SUGGESTED_BRANCH);
    setBranch(null);
    setCode(START_CODE);
    setCommits([]);
    setPushed(0);
    setLog([]);
    setPr(null);
  };

  return (
    <div className="cl space-y-5">
      {SHOW_STEPPER && <Stepper stage={stage} />}

      {/* The introduction and the branch box make way for the work once the branch exists. */}
      {!branch && (
        <>
          <p className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Timer className="size-4" />
            5–7 minutes
          </p>
          <TicketCard />
          <BranchStep
            value={branchInput}
            onChange={setBranchInput}
            onCreate={(name) => {
              setBranch(name);
              say({ cmd: `git switch -c ${name}`, out: `Switched to a new branch '${name}'` });
              setStage("edit");
            }}
          />
        </>
      )}

      {stage === "edit" && branch && (
        <EditStep
          code={code}
          committed={committed}
          branch={branch}
          onChange={setCode}
          onReset={() => setCode(committed)}
          onReview={() => {
            say({ cmd: `git add ${FILE}` });
            setStage("commit");
          }}
          next={commits.length === 0 ? null : commits.length > pushed ? "push" : "pr"}
          onNext={setStage}
        />
      )}

      {stage === "commit" && branch && (
        <CommitStep
          before={committed}
          after={code}
          onBack={() => setStage("edit")}
          onCommit={(message) => {
            const hash = fakeHash(`${commits.length}:${message}:${code}`);
            const { added, removed } = diffStats(lineDiff(committed, code));
            setCommits((c) => [...c, { hash, message, code }]);
            say({
              cmd: `git commit -m "${message.replaceAll('"', '\\"')}"`,
              out: `[${branch} ${hash}] ${message}\n 1 file changed, ${added} insertion${added === 1 ? "" : "s"}(+), ${removed} deletion${removed === 1 ? "" : "s"}(-)`,
            });
            setStage("push");
          }}
        />
      )}

      {stage === "push" && branch && (
        <PushStep
          branch={branch}
          commits={commits}
          pushed={pushed}
          onPushed={() => {
            say({
              cmd: pushed === 0 ? `git push -u origin ${branch}` : "git push",
              out:
                pushed === 0
                  ? `To code.harness.io/${REPO}.git\n * [new branch]      ${branch} -> ${branch}`
                  : `To code.harness.io/${REPO}.git\n   ${commits[pushed - 1]!.hash}..${commits.at(-1)!.hash}  ${branch} -> ${branch}`,
            });
            setPushed(commits.length);
            setStage("pr");
          }}
        />
      )}

      {stage === "pr" && branch && (
        <PrFormStep
          branch={branch}
          commits={commits}
          pushed={pushed}
          onOpen={(title, body) => {
            setPr({ title, body });
            say({ cmd: `# Opened pull request #${PR_NUMBER} in Harness Code: ${branch} → main` });
            setStage("review");
          }}
        />
      )}

      {stage === "review" && branch && pr && (
        <PullRequestPage
          title={pr.title}
          body={pr.body}
          author={author}
          branch={branch}
          commits={commits}
          baseCode={START_CODE}
          onMerge={() => {
            say({ cmd: `# Merged pull request #${PR_NUMBER} into main` }, { cmd: "git switch main && git pull", out: `Updating ${MAIN_HASH}..${fakeHash(`merge:${commits.at(-1)!.hash}`)}\nFast-forward\n ${FILE} | changed` });
            setStage("merged");
          }}
        />
      )}

      {stage === "merged" && <MergedStep code={committed} onRestart={restart} />}

      <Terminal log={log} />
    </div>
  );
}

/** The welcome, attached to the ticket it introduces the way a step's explanation sits on top of its step. */
function TicketCard() {
  return (
    <section className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex gap-3 bg-brand-subtle/50 px-5 py-4 text-sm">
        {/* Lucide has no waving hand, and its open palm reads as "stop". */}
        <span className="text-base leading-5" aria-hidden>
          👋
        </span>
        <p className="max-w-3xl">
          <span className="font-medium">Hey there!</span> Welcome to your first day as a software developer at the Greenleaf Shop. We’re super busy here
          working on our Spring Sale. Jump right in and help Jordan. He submitted the ticket below asking for updates to our website.
        </p>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Ticket className="size-4 text-brand" />
          <span className="font-mono text-xs text-muted-foreground">{TICKET.id}</span>
          <span className="font-medium">{TICKET.title}</span>
          <span className="text-xs text-muted-foreground">· from {TICKET.from}</span>
        </div>
        <p className="text-sm text-muted-foreground">{TICKET.body}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm marker:text-muted-foreground">
          {TASKS.map((t) => (
            <li key={t.id}>{t.label}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Stepper({ stage }: { stage: Stage }) {
  const at = ORDER.indexOf(stage);
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2" aria-label="Steps">
      {STEPS.map(({ label, Icon, stages }, k) => {
        const last = Math.max(...stages.map((s) => ORDER.indexOf(s)));
        const done = at > last || stage === "merged";
        const current = !done && stages.includes(stage);
        return (
          <li key={label} className="flex items-center gap-1" aria-current={current ? "step" : undefined}>
            {k > 0 && <span className={cn("h-px w-4 sm:w-8", done || current ? "bg-brand" : "bg-border")} />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                current && "border-brand bg-brand text-brand-foreground",
                done && "border-brand-border bg-brand-subtle text-foreground",
                !current && !done && "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The card a step sits in: what the step is and why, anything that explains it further, then its controls. */
function StepCard({
  title,
  why,
  info,
  children,
  className,
}: {
  title: string;
  why: React.ReactNode;
  info?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("divide-y overflow-hidden rounded-2xl border bg-card shadow-sm", className)}>
      <div className="space-y-3 bg-brand-subtle/50 px-5 py-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium tracking-tight">{title}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{why}</p>
        </div>
        {info}
      </div>
      {children}
    </section>
  );
}

function BranchStep({
  value,
  onChange,
  onCreate,
}: {
  value: string;
  onChange: (v: string) => void;
  onCreate: (name: string) => void;
}) {
  const name = cleanBranchName(value);
  return (
    <StepCard
      title="Create a branch"
      why={
        <>
          It’s important to make changes in your own safe space. When developing, this is usually called “creating a branch”: sort of like a “branch”
          sprouting off the main tree “trunk”. It’s very similar to team members making a copy of a Google Slides deck so they don’t interfere with each
          other as they make changes.
        </>
      }
      info={
        <div className="flex flex-col gap-1 overflow-x-auto">
          <span className="text-xs font-medium text-muted-foreground">{REPO} · on main</span>
          <HistoryGraph branch={null} commits={0} pushed={0} merged={false} />
        </div>
      }
    >
      <form
        className="flex flex-wrap items-end gap-3 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) onCreate(name);
        }}
      >
        <label className="grid min-w-64 grow gap-1.5 text-sm sm:max-w-md">
          <span className="font-medium">Branch name</span>
          <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" spellCheck={false} />
        </label>
        <Button type="submit" variant="brand" disabled={!name}>
          <GitBranch />
          Create branch
        </Button>
        <p className="basis-full text-xs text-muted-foreground">Teams usually put the ticket number in the name, so anyone can tell what the branch is for.</p>
      </form>
    </StepCard>
  );
}

function EditStep({
  code,
  committed,
  branch,
  onChange,
  onReset,
  onReview,
  next,
  onNext,
}: {
  code: string;
  committed: string;
  branch: string;
  onChange: (code: string) => void;
  onReset: () => void;
  onReview: () => void;
  /** Where to go on without another commit: push what isn't pushed yet, or open the pull request. Null before the first commit. */
  next: "push" | "pr" | null;
  onNext: (stage: "push" | "pr") => void;
}) {
  const [view, setView] = useState<"preview" | "changes">("preview");
  const [pointing, setPointing] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const preview = useDeferredValue(code);
  const highlight = TASKS.find((t) => t.id === pointing)?.locate(code) ?? null;
  const { added, removed } = diffStats(lineDiff(committed, code));
  const changed = added + removed > 0;
  const allDone = TASKS.every((t) => t.done(code));

  return (
    <StepCard
      title="Implement Jordan’s changes"
      why="Here is the code from the main “trunk” ready for your updates! On the right, you can see a preview of how your code updates will impact the view. Neat, right? The changes to make are shown below. Hover over a change for a hint."
      info={
        <TooltipProvider>
          <ul className="grid gap-2 sm:grid-cols-3">
            {TASKS.map((t) => {
              const done = t.done(code);
              return (
                <li key={t.id}>
                  <Tooltip onOpenChange={(open) => setPointing((p) => (open ? t.id : p === t.id ? null : p))}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          // Put the cursor on the code to change, so typing replaces it.
                          const range = t.locate(code);
                          const input = inputRef.current;
                          if (!range || !input) return;
                          input.focus({ preventScroll: true });
                          input.setSelectionRange(...range);
                        }}
                        className="flex size-full cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-brand-border data-[state=delayed-open]:border-brand-border data-[state=instant-open]:border-brand-border"
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                            done ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500" : "border-muted-foreground/40",
                          )}
                        >
                          {done && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span>{t.label}</span>
                        <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm space-y-1.5">
                      <p>{t.hint}</p>
                      <pre className="rounded bg-muted px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">{t.suggestion}</pre>
                      <p className="text-muted-foreground">Click to put your cursor there.</p>
                    </TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </TooltipProvider>
      }
    >
      <div className="grid lg:grid-cols-2 lg:divide-x max-lg:divide-y">
        <div className="min-w-0">
          <div className="flex items-center gap-2 border-b px-4 py-2 text-xs">
            <span className="font-mono font-medium">{FILE}</span>
            {changed && <span className="size-2 rounded-full bg-brand" aria-label="Unsaved changes" />}
            <span className="ml-auto inline-flex items-center gap-1 font-mono text-muted-foreground">
              <GitBranch className="size-3" />
              {branch}
            </span>
          </div>
          <CodeEditor
            value={code}
            onChange={onChange}
            label={`Code editor for ${FILE}`}
            highlight={highlight}
            inputRef={inputRef}
            className="h-[30rem]"
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-1 border-b px-2 py-1" role="tablist" aria-label="Result">
            {(
              [
                ["preview", "Preview", Eye],
                ["changes", `Changes${changed ? ` (+${added} −${removed})` : ""}`, FileDiff],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          {view === "preview" ? (
            <BrowserFrame code={preview} address="preview.greenleaf.shop" className="h-[30rem]" />
          ) : (
            <div className="h-[30rem] overflow-auto p-4">
              <DiffView before={committed} after={code} file={FILE} />
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        {changed && (
          <Button variant="ghost" onClick={onReset}>
            <RotateCcw />
            Undo all changes
          </Button>
        )}
        <div className="ml-auto">
          {/* Once everything is committed, carry on from there rather than to an empty commit. */}
          {next && !changed ? (
            <Button variant="brand" onClick={() => onNext(next)}>
              {next === "push" ? <CloudUpload /> : <GitPullRequest />}
              {next === "push" ? "Continue to push" : "Continue to pull request"}
            </Button>
          ) : (
            <Button variant="brand" disabled={!changed || !allDone} onClick={onReview}>
              Continue
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </StepCard>
  );
}

/**
 * The shop's page in a pretend browser window, with its stylesheet filled in.
 * Scripts never run in it: the frame is
 * sandboxed. A frame goes blank while it loads new content, so a change loads
 * in a hidden second frame and the page shown swaps to it once it has loaded.
 */
function BrowserFrame({ code, address, className }: { code: string; address: string; className?: string }) {
  const [frames, setFrames] = useState(() => [{ id: 0, code }]);
  const latest = frames.at(-1)!;
  if (latest.code !== code) setFrames(frames[0]!.code === code ? [frames[0]!] : [frames[0]!, { id: latest.id + 1, code }]);

  return (
    <div className={cn("flex flex-col bg-muted/40 p-3", className)}>
      <div className="flex grow flex-col overflow-hidden rounded-lg border bg-background shadow-xs">
        <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-1.5">
          <span className="flex gap-1" aria-hidden>
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
          </span>
          <span className="mx-auto rounded bg-background px-3 py-0.5 font-mono text-[11px] text-muted-foreground">{address}</span>
        </div>
        <div className="relative grow bg-white">
          {frames.map((f, k) => (
            <iframe
              key={f.id}
              title={`What ${address} shows`}
              sandbox=""
              srcDoc={pageHtml(f.code)}
              onLoad={() => setFrames((fs) => fs.slice(Math.max(0, fs.findIndex((g) => g.id === f.id))))}
              className={cn("absolute inset-0 size-full", k > 0 && "invisible")}
              aria-hidden={k > 0 || undefined}
              tabIndex={k > 0 ? -1 : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CommitStep({ before, after, onBack, onCommit }: { before: string; after: string; onBack: () => void; onCommit: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const trimmed = message.trim();
  return (
    <StepCard
      title="Commit your change"
      why="Committing the change saves your changes as a snapshot. Below, you can see how that commit snapshot looks. Lines of code you changed show as the old line removed (minus sign) and the new line added (plus sign). Type a commit message indicating why you made the change, then click Commit."
    >
      <div className="px-5 py-4">
        <DiffView before={before} after={after} file={FILE} />
      </div>
      <form
        className="flex flex-wrap items-end gap-3 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onCommit(trimmed);
        }}
      >
        <label className="grid min-w-64 grow gap-1.5 text-sm">
          <span className="font-medium">Commit message</span>
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Update the spring sale banner to 20% off" autoFocus />
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>
            Back to editing
          </Button>
          <Button type="submit" variant="brand" disabled={!trimmed}>
            <GitCommitHorizontal />
            Commit
          </Button>
        </div>
        <p className="basis-full text-xs text-muted-foreground">Say what changed and why, in a line. Months from now, this is how someone finds out.</p>
      </form>
    </StepCard>
  );
}

function PushStep({
  branch,
  commits,
  pushed,
  onPushed,
}: {
  branch: string;
  commits: Commit[];
  pushed: number;
  onPushed: () => void;
}) {
  const [pushing, setPushing] = useState(false);
  return (
    <StepCard
      title="Push your branch"
      why={
        <>
          Your commit is saved, but only the copy on your computer. Pushing the branch copies your change up to the code repository. Once it is there,
          teammates can also review the change (often called a peer review), and pipelines can access the code to build and deploy. Click the “Push{" "}
          {branch}” button.
        </>
      }
    >
      <div className="divide-y text-sm">
        {commits.map((c, k) => (
          <div key={c.hash} className="flex items-center gap-3 px-5 py-2.5">
            <GitCommitHorizontal className="size-4 shrink-0 text-brand" />
            <span className="min-w-0 grow truncate">{c.message}</span>
            <code className="shrink-0 text-xs text-muted-foreground">{c.hash}</code>
            <span className={cn("w-24 shrink-0 text-right text-xs", k < pushed ? "text-muted-foreground" : "font-medium text-brand")}>
              {k < pushed ? "on Harness Code" : "only on laptop"}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4">
        <Button
          variant="brand"
          disabled={pushing}
          onClick={() => {
            setPushing(true);
            setTimeout(onPushed, 900);
          }}
        >
          {pushing ? <Loader2 className="animate-spin" /> : <CloudUpload />}
          {pushing ? "Pushing…" : `Push ${branch}`}
        </Button>
      </div>
    </StepCard>
  );
}

function PrFormStep({
  branch,
  commits,
  pushed,
  onOpen,
}: {
  branch: string;
  commits: Commit[];
  pushed: number;
  onOpen: (title: string, body: string) => void;
}) {
  const [title, setTitle] = useState(commits.length === 1 ? commits[0]!.message : TICKET.title);
  const [body, setBody] = useState(`Closes ${TICKET.id}.\n\nUpdates the home page banner for the spring sale.`);
  const trimmed = title.trim();
  return (
    <StepCard
      title="Open a pull request"
      why={
        <>
          A pull request is when you ask for your branch to get pulled back into the main branch. (If you’re thinking “gosh, that’s not how trees work”,
          that’s valid. Apparently developers don’t get outside much.) But <code className="text-foreground">main</code> is the branch in most companies
          that eventually deploys into the real customer environment. So click “Open pull request” to say your changes are ready to get pulled into main.
        </>
      }
      info={
        <div className="flex flex-col gap-1 overflow-x-auto">
          <span className="text-xs font-medium text-muted-foreground">
            {branch} → main · {commits.length} commit{commits.length === 1 ? "" : "s"}, 1 file changed
          </span>
          <HistoryGraph branch={branch} commits={commits.length} pushed={pushed} merged={false} requested />
        </div>
      }
    >
      <form
        className="grid gap-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onOpen(trimmed, body.trim());
        }}
      >
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Title</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Description</span>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="brand" disabled={!trimmed}>
            <GitPullRequest />
            Open pull request
          </Button>
        </div>
      </form>
    </StepCard>
  );
}

function MergedStep({ code, onRestart }: { code: string; onRestart: () => void }) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLive(true), 2200);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <StepCard
        title={live ? "Merged! Deployed" : "Merged! Deploying…"}
        why={
          <>
            Your branch is now part of <code className="text-foreground">main</code>. Merging started the pipeline, which tested the code again and{" "}
            {live ? "deployed it to the live site." : "is deploying it to the live site."} From ticket to customers, nobody copied a file by hand.
          </>
        }
      >
        <div className="flex items-center gap-3 px-5 py-3 text-sm">
          {live ? <Check className="size-4 text-emerald-600 dark:text-emerald-400" /> : <Loader2 className="size-4 animate-spin text-brand" />}
          <span>{live ? "Deployed to production by Harness CD" : "Harness CD is deploying main to production…"}</span>
        </div>
      </StepCard>
      {live && (
        <StepCard title="Your change is live" why="Anyone who visits the shop now sees the spring sale the way you wrote it.">
          <BrowserFrame code={code} address="greenleaf.shop" className="h-[26rem]" />
          <div className="flex justify-end px-5 py-4">
            <Button variant="outline" onClick={onRestart}>
              <RotateCcw />
              Start over
            </Button>
          </div>
        </StepCard>
      )}
    </>
  );
}

function Terminal({ log }: { log: LogLine[] }) {
  const [open, setOpen] = useState(false);
  if (log.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border bg-zinc-950 text-zinc-100 shadow-sm" aria-label="Behind the scenes">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 px-5 py-2 text-left text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200",
          open && "border-b border-white/10",
        )}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        Behind the scenes: the git commands each step stands for
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto px-5 py-3 font-mono text-xs leading-relaxed">
          {log.map((l, k) => (
            <span key={k} className="block">
              {l.cmd.startsWith("#") ? (
                <span className="text-zinc-500">{l.cmd}</span>
              ) : (
                <>
                  <span className="text-emerald-400">$ </span>
                  {l.cmd}
                </>
              )}
              {l.out && <span className="block text-zinc-400">{l.out}</span>}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}
