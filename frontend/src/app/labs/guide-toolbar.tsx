"use client";

/**
 * The insert toolbar above a guide's body. Anything that comes in more than one
 * form — a heading level, a callout tone, a code language, a placeholder — is a
 * menu, so every form is visible instead of only whichever one the button
 * happened to write.
 */

import {
  Braces,
  ChevronDown,
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
  /** A quiet second line, for when the label alone does not say enough. */
  detail?: string;
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
  return (
    <DropdownMenu>
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
        className="min-w-56 max-w-80"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Named triggers say it already. */}
        {!tool.named && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {tool.label}
          </DropdownMenuLabel>
        )}

        {tool.options.map((option) => (
          <DropdownMenuItem
            key={option.label}
            onSelect={() => onInsert(option)}
            className="items-start"
          >
            {option.icon && (
              <option.icon className="mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 truncate">{option.label}</span>
                {option.token && (
                  <code className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                    {option.token}
                  </code>
                )}
              </span>
              {option.detail && (
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {option.detail}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
});

const callout = (
  name: string,
  label: string,
  title: string,
  body: string,
  icon: LucideIcon,
): ToolOption => ({
  label,
  token: `:::${name}`,
  detail: body,
  icon,
  snippet: `:::${name} ${title}\n${body}\n:::`,
  select: title,
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
      {
        label: "Folded away",
        token: ":::details",
        detail: "Closed until the reader opens it — a hint, or a long output.",
        snippet: `:::details[Show the answer]
What to keep folded away until it is wanted — a hint, a long output, or what
to do when it goes wrong.
:::`,
        select: "Show the answer",
      },
      {
        label: "Open to start",
        token: "{open}",
        detail: "Shown open, and the reader can fold it away.",
        snippet: `:::details[Before you begin]{open}
What is worth reading now but not worth scrolling past later.
:::`,
        select: "Before you begin",
      },
    ],
  },
  {
    label: "Placeholder",
    icon: Braces,
    named: true,
    options: GUIDE_VARIABLES.map((variable) => ({
      label: variable.label,
      token: `{{${variable.name}}}`,
      snippet: `{{${variable.name}}}`,
      inline: true,
    })),
  },
];
