"use client";

/**
 * The Code Lab's editor: a plain textarea over a highlighted copy of its text
 * (code-lab.css says how the two stay aligned), with line numbers. Typing,
 * selecting and undo are the browser's own.
 */

import { useMemo } from "react";
import { highlightHtml } from "@/lib/mimir/code-lab/highlight";
import { cn } from "@/lib/utils";

export function CodeEditor({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const tokens = useMemo(() => highlightHtml(value), [value]);
  const lineCount = value.split("\n").length;
  const numbers = useMemo(() => Array.from({ length: lineCount }, (_, k) => k + 1).join("\n"), [lineCount]);

  return (
    <div className={cn("cl-editor", className)}>
      <div className="cl-gutter" aria-hidden>
        {numbers}
      </div>
      <div className="cl-surface">
        <pre className="cl-code" aria-hidden>
          {tokens.map((t, k) => (
            <span key={k} className={`cl-${t.kind}`}>
              {t.text}
            </span>
          ))}
          {/* A textarea ending in a newline shows an empty last line; a pre doesn't without something after it. */}{" "}
        </pre>
        <textarea
          className="cl-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
        />
      </div>
    </div>
  );
}
