"use client";

/**
 * The insert toolbar above a guide's body. Anything that comes in more than one
 * form — a heading level, a callout tone, a code language, a placeholder — is a
 * menu, so every form is visible instead of only whichever one the button
 * happened to write.
 *
 * Each menu carries a preview of whatever is highlighted, built out of the same
 * classes the rendered guide uses. So the choice is made by looking at the
 * result rather than by reading the Markdown that produces it.
 */

import { useState, type ReactNode } from "react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Code,
  Heading,
  Heading2,
  Heading3,
  Heading4,
  Info,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  OctagonAlert,
  PencilLine,
  Table,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GUIDE_VARIABLES } from "@/lib/guide-variables";
import { cn } from "@/lib/utils";

/** What inserting an option puts in the body. */
export type ToolInsert = {
  snippet: string;
  /** Highlighted after inserting, so the first thing to change is selected. */
  select?: string;
  /** Written at the cursor rather than as a block of its own. */
  inline?: boolean;
};

type ToolOption = ToolInsert & {
  label: string;
  /** Shown in mono beside the label: the markdown this option writes. */
  token?: string;
  /** Captions the preview, for what looking at it does not tell you. */
  detail?: string;
  /** What the option renders as, drawn with the guide's own styles. */
  preview?: ReactNode;
  icon?: LucideIcon;
};

type Tool = {
  label: string;
  icon: LucideIcon;
  /** Named in the toolbar rather than left to its icon. */
  named?: boolean;
  options: ToolOption[];
};

export function GuideToolbar({
  onInsert,
}: {
  onInsert: (insert: ToolInsert) => void;
}) {
  return (
    <>
      {TOOLS.map((tool) =>
        tool.options.length === 1 ? (
          <Button
            key={tool.label}
            type="button"
            variant="ghost"
            size="icon"
            title={`Insert ${tool.label.toLowerCase()}`}
            aria-label={`Insert ${tool.label.toLowerCase()}`}
            onClick={() => onInsert(tool.options[0])}
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <tool.icon />
          </Button>
        ) : (
          <ToolMenu key={tool.label} tool={tool} onInsert={onInsert} />
        ),
      )}
    </>
  );
}

function ToolMenu({
  tool,
  onInsert,
}: {
  tool: Tool;
  onInsert: (insert: ToolInsert) => void;
}) {
  /* Which option the preview is showing. Radix focuses an item on hover as well
     as by keyboard, so focus alone tracks both ways of looking down a menu; the
     last one looked at stays up, so the pane never blinks empty on the way out. */
  const [shown, setShown] = useState(0);
  const preview = tool.options[shown] ?? tool.options[0];

  return (
    <DropdownMenu onOpenChange={(open) => open && setShown(0)}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={`Insert ${tool.label.toLowerCase()}`}
          aria-label={`Insert ${tool.label.toLowerCase()}`}
          className={cn(
            "h-8 gap-0.5 text-muted-foreground hover:text-foreground",
            tool.named ? "px-2" : "px-1.5",
          )}
        >
          <tool.icon />
          {tool.named && <span className="ml-1">{tool.label}</span>}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      {/* The insert puts the caret back in the body itself, so Radix must not
          pull focus to the trigger as the menu closes. */}
      <DropdownMenuContent
        align="start"
        className="w-80 p-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Long menus scroll; the preview below them does not scroll away. */}
        <div className="max-h-72 overflow-y-auto p-1">
          {/* Named triggers say it already. */}
          {!tool.named && (
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {tool.label}
            </DropdownMenuLabel>
          )}

          {tool.options.map((option, index) => (
            <DropdownMenuItem
              key={option.label}
              onFocus={() => setShown(index)}
              onSelect={() => onInsert(option)}
            >
              {option.icon && (
                <option.icon className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.token && (
                <code className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {option.token}
                </code>
              )}
            </DropdownMenuItem>
          ))}
        </div>

        {/* The pane keeps the page's own surface rather than the popover's: a
            code block's fill is mixed with the background it expects to be
            sitting on. */}
        {(preview.detail || preview.preview) && (
          <div className="border-t bg-background px-3 py-2.5">
            {preview.detail && (
              <p className="text-xs leading-snug text-muted-foreground">
                {preview.detail}
              </p>
            )}
            {/* Decoration: the menu is the control, this is only what it makes. */}
            {preview.preview && (
              <div
                aria-hidden="true"
                className={cn(
                  "lab-prose pointer-events-none select-none",
                  preview.detail && "mt-2",
                )}
              >
                {preview.preview}
              </div>
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/*
 * The previews below rebuild what `markdown.ts` emits, rather than running the
 * renderer: every treatment a guide body has is a class in `globals.css`, and
 * the icons that file draws by hand are these same Lucide glyphs. So a faithful
 * preview costs a few elements and no server round trip. Structure matters more
 * than it looks like it should — `.lab-callout-head`, `.lab-code-head` and the
 * rest are styled where they sit.
 */

const heading = (
  level: 2 | 3 | 4,
  label: string,
  title: string,
  detail: string,
  icon: LucideIcon,
): ToolOption => ({
  label,
  token: "#".repeat(level),
  detail,
  icon,
  snippet: `${"#".repeat(level)} ${title}`,
  select: title,
  preview: (
    <>
      {level === 2 ? (
        <h2>{title}</h2>
      ) : level === 3 ? (
        <h3>{title}</h3>
      ) : (
        <h4>{title}</h4>
      )}
      <p>How the step begins.</p>
    </>
  ),
});

const callout = (
  name: string,
  label: string,
  title: string,
  body: string,
  Icon: LucideIcon,
): ToolOption => ({
  label,
  token: `:::${name}`,
  icon: Icon,
  snippet: `:::${name} ${title}\n${body}\n:::`,
  select: title,
  preview: (
    <div className="lab-callout" data-callout={name}>
      <p className="lab-callout-head">
        {/* The renderer draws this glyph as a hand-written path; same shape. */}
        <Icon className="lab-callout-icon" />
        <span className="lab-callout-title">{title}</span>
      </p>
      <div className="lab-callout-body">
        <p>{body}</p>
      </div>
    </div>
  ),
});

const fenced = (
  label: string,
  lang: string,
  body: string,
  title?: string,
): ToolOption => ({
  label,
  token: lang,
  snippet: `\`\`\`${lang}${title ? ` title="${title}"` : ""}\n${body}\n\`\`\``,
  // The first line only: a selection spanning a newline would not survive being
  // re-indented into a list.
  select: body.split("\n")[0],
  // Untitled, the language names the block; titled, it becomes the subtitle.
  preview: (
    <figure className="lab-code my-0">
      <figcaption className="lab-code-head">
        <span className="lab-code-title">{title ?? label}</span>
        {title && <span className="lab-code-lang">{label}</span>}
      </figcaption>
      {/* A line wider than the menu trails off, rather than ending mid-word as
          though it had been cut. */}
      <pre className="mask-r-from-85% overflow-hidden px-3.5 py-3 font-mono text-[0.8125rem] leading-[1.65]">
        {body}
      </pre>
    </figure>
  ),
});

const collapsible = (
  label: string,
  token: string,
  detail: string,
  title: string,
  body: string,
  open: boolean,
): ToolOption => ({
  label,
  token,
  detail,
  snippet: `:::details[${title}]${open ? "{open}" : ""}\n${body}\n:::`,
  select: title,
  preview: (
    <details className="lab-details" open={open}>
      <summary className="lab-details-summary">
        <ChevronRight className="lab-details-chevron" />
        <span className="lab-details-title">{title}</span>
      </summary>
      <div className="lab-details-body">
        <p>{body}</p>
      </div>
    </details>
  ),
});

const TERRAFORM = `resource "harness_platform_project" "demo" {
  identifier = "demo"
}`;

const TOOLS: Tool[] = [
  {
    label: "Heading",
    icon: Heading,
    options: [
      heading(
        2,
        "Section",
        "Section title",
        "A main step, listed in the contents.",
        Heading2,
      ),
      heading(
        3,
        "Sub-section",
        "Sub-step title",
        "Nested under a section, also listed in the contents.",
        Heading3,
      ),
      heading(
        4,
        "Minor heading",
        "Detail",
        "A break inside a step, left out of the contents.",
        Heading4,
      ),
    ],
  },
  {
    label: "Bulleted list",
    icon: List,
    options: [
      {
        label: "Bulleted list",
        snippet: `- What the attendee needs open
- Where they are starting from
- What they will have at the end`,
        select: "What the attendee needs open",
      },
    ],
  },
  {
    label: "Numbered list",
    icon: ListOrdered,
    options: [
      {
        label: "Numbered list",
        snippet: `1. Open the console
2. Create the resource
3. Check that it came up`,
        select: "Open the console",
      },
    ],
  },
  {
    label: "Task list",
    icon: ListChecks,
    options: [
      {
        label: "Task list",
        snippet: `- [ ] Something to tick off
- [ ] Something else to tick off`,
        select: "Something to tick off",
      },
    ],
  },
  {
    label: "Table",
    icon: Table,
    options: [
      {
        label: "Table",
        snippet: `| Setting | Value | Notes |
| --- | --- | --- |
| Region | \`us-central1\` | Match the project default |
| Machine type | \`e2-standard-4\` | Smaller runs out of memory |`,
        select: "Setting",
      },
    ],
  },
  {
    label: "Code block",
    icon: Code,
    options: [
      fenced("Shell", "bash", "gcloud auth login", "setup.sh"),
      fenced("Shell session", "shellsession", "$ kubectl get pods"),
      fenced("YAML", "yaml", "replicas: 2", "values.yaml"),
      fenced("JSON", "json", `{ "name": "example" }`),
      fenced("Terraform", "hcl", TERRAFORM, "main.tf"),
      fenced("Dockerfile", "dockerfile", "FROM node:22-alpine", "Dockerfile"),
      fenced("Python", "python", `print("hello")`),
      fenced("TypeScript", "typescript", `console.log("hello");`),
      fenced("Go", "go", `fmt.Println("hello")`),
      fenced("SQL", "sql", "select count(*) from pipelines;"),
      fenced("Diff", "diff", `-  replicas: 1
+  replicas: 2`),
      fenced("Plain text", "text", "Paste the output you expect to see."),
    ],
  },
  {
    label: "Callout",
    icon: Info,
    options: [
      callout(
        "note",
        "Note",
        "Worth knowing",
        "Something to keep in mind as you go.",
        PencilLine,
      ),
      callout(
        "tip",
        "Tip",
        "A shortcut",
        "A faster way to get the same result.",
        Info,
      ),
      callout(
        "success",
        "Success",
        "That worked",
        "How to tell it worked, and what you should be looking at.",
        CircleCheck,
      ),
      callout(
        "warning",
        "Warning",
        "Take care here",
        "Something that is easy to get wrong at this step.",
        TriangleAlert,
      ),
      callout(
        "danger",
        "Caution",
        "Do not skip this",
        "What will break the rest of the lab if it is wrong.",
        OctagonAlert,
      ),
    ],
  },
  {
    label: "Collapsible section",
    icon: ListCollapse,
    options: [
      collapsible(
        "Folded away",
        ":::details",
        "Closed until the reader opens it — a hint, or a long output.",
        "Show the answer",
        "What to keep folded away until it is wanted.",
        false,
      ),
      collapsible(
        "Open to start",
        "{open}",
        "Shown open, and the reader can fold it away.",
        "Before you begin",
        "What is worth reading now but not worth scrolling past later.",
        true,
      ),
    ],
  },
  {
    label: "Placeholder",
    icon: Braces,
    named: true,
    options: GUIDE_VARIABLES.map((variable) => ({
      label: variable.label,
      token: `{{${variable.name}}}`,
      detail: variable.hint,
      snippet: `{{${variable.name}}}`,
      inline: true,
      // Not markup but a value: what stands here for one particular reader. A
      // link's is long enough to fill the menu, so it is cut off rather than
      // shown whole — the shape of it is the useful part.
      preview: (
        <p className="line-clamp-2 break-all">
          Reads as <code>{variable.example}</code>
        </p>
      ),
    })),
  },
];
