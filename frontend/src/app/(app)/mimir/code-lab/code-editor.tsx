"use client";

/**
 * The Code Lab's editor: a plain textarea over a highlighted copy of its text
 * (code-lab.css says how the two stay aligned), with line numbers. Typing,
 * selecting and undo are the browser's own. A highlighted range is marked in a
 * layer under the code and scrolled into view inside the editor.
 */

import { useEffect, useMemo, useRef } from "react";
import { highlightHtml } from "@/lib/mimir/code-lab/highlight";
import { cn } from "@/lib/utils";

/** How far a mark scrolled into view stands off the editor's edges, in pixels. */
const SCROLL_MARGIN = 24;

export function CodeEditor({
  value,
  onChange,
  label,
  highlight,
  inputRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** A [start, end) range of the value to mark, or null for none. */
  highlight?: [number, number] | null;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  className?: string;
}) {
  const tokens = useMemo(() => highlightHtml(value), [value]);
  const lineCount = value.split("\n").length;
  const numbers = useMemo(() => Array.from({ length: lineCount }, (_, k) => k + 1).join("\n"), [lineCount]);
  const editorRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const markStart = highlight?.[0];

  useEffect(() => {
    const editor = editorRef.current;
    const mark = markRef.current;
    if (markStart === undefined || !editor || !mark) return;
    // The mark's offsets are from the top left of the code, which is the top of the scrolled content and just right of the gutter.
    const gutter = gutterRef.current?.offsetWidth ?? 0;
    const top = mark.offsetTop;
    const left = mark.offsetLeft;
    const scroll: ScrollToOptions = { behavior: "smooth" };
    if (top < editor.scrollTop + SCROLL_MARGIN || top + mark.offsetHeight > editor.scrollTop + editor.clientHeight - SCROLL_MARGIN) {
      scroll.top = Math.max(0, top - editor.clientHeight / 3);
    }
    if (left < editor.scrollLeft || gutter + left + mark.offsetWidth > editor.scrollLeft + editor.clientWidth - SCROLL_MARGIN) {
      scroll.left = Math.max(0, left - SCROLL_MARGIN);
    }
    if (scroll.top !== undefined || scroll.left !== undefined) editor.scrollTo(scroll);
  }, [markStart]);

  return (
    <div ref={editorRef} className={cn("cl-editor", className)}>
      <div ref={gutterRef} className="cl-gutter" aria-hidden>
        {numbers}
      </div>
      <div className="cl-surface">
        {highlight && (
          <pre className="cl-code cl-marks" aria-hidden>
            {value.slice(0, highlight[0])}
            <mark ref={markRef} className="cl-mark">
              {/* An empty range still gets a mark a character wide, so there is something to see where to type. */}
              {value.slice(...highlight) || " "}
            </mark>
            {value.slice(highlight[1])}{" "}
          </pre>
        )}
        <pre className="cl-code" aria-hidden>
          {tokens.map((t, k) => (
            <span key={k} className={`cl-${t.kind}`}>
              {t.text}
            </span>
          ))}
          {/* A textarea ending in a newline shows an empty last line; a pre doesn't without something after it. */}{" "}
        </pre>
        <textarea
          ref={inputRef}
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
