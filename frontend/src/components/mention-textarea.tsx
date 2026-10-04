"use client";

/**
 * A textarea that tags people with "@": typing "@" and part of a name lists
 * who matches, and picking one writes "@Full Name" into the text. Arrow keys
 * move through the list, Enter or Tab picks, Escape closes it. Who was picked
 * is reported beside the text, since the text alone cannot tell two people
 * with one name apart.
 *
 * `singleLine` makes it a one-line field for a name: Enter submits its form
 * rather than starting a new line.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { insertMention, matchesMention, mentionQueryAt, type MentionPick } from "@/lib/mentions";
import { cn } from "@/lib/utils";

const SHOWN = 8;

export function MentionTextarea({
  value,
  onChange,
  people,
  onPick,
  onKeyDown,
  className,
  singleLine = false,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onChange: (text: string) => void;
  /** Who can be tagged. */
  people: MentionPick[];
  onPick: (pick: MentionPick) => void;
  singleLine?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // A page can hold many of these, as the scoring form does, so each list has its own ids.
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  /** The "@" whose list was closed, by picking from it or by Escape: it stays closed until another "@". */
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const moveCaret = useRef<number | null>(null);

  const tag = people.length > 0 ? mentionQueryAt(value, caret) : null;
  // Only someone with a name can be tagged: the tag is the name.
  const matches =
    tag && tag.start !== closedAt ? people.filter((p) => p.fullName && matchesMention(p, tag.query)).slice(0, SHOWN) : [];
  const open = matches.length > 0;
  const current = Math.min(active, matches.length - 1);

  // Escape closes the list, not the dialog the box is in. A dialog listens on the
  // document as the key goes down, so this listens on the window, which hears it first.
  const tagStart = open ? tag!.start : null;
  useEffect(() => {
    if (tagStart === null) return;
    const close = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || document.activeElement !== ref.current) return;
      e.stopPropagation();
      setClosedAt(tagStart);
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [tagStart]);

  useLayoutEffect(() => {
    if (moveCaret.current === null || !ref.current) return;
    ref.current.setSelectionRange(moveCaret.current, moveCaret.current);
    moveCaret.current = null;
  }, [value]);

  const pick = (p: MentionPick) => {
    if (!tag) return;
    const next = insertMention(value, tag.start, caret, p);
    moveCaret.current = next.caret;
    setCaret(next.caret);
    setClosedAt(tag.start);
    onPick(p);
    onChange(next.text);
  };

  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && !(e.metaKey || e.ctrlKey)) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const by = e.key === "ArrowDown" ? 1 : -1;
        return setActive((current + by + matches.length) % matches.length);
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return pick(matches[current]!);
      }
    }
    if (singleLine && e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          // A pasted newline in a one-line field becomes a space.
          onChange(singleLine ? e.target.value.replace(/\n/g, " ") : e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={keyDown}
        onBlur={() => setClosedAt(tag?.start ?? null)}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        rows={singleLine ? 1 : undefined}
        className={cn(singleLine && "min-h-9 resize-none overflow-hidden py-1.5", className)}
        {...props}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People to tag"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg"
        >
          {matches.map((p, i) => (
            <li
              key={p.email}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              // Picked on press, before the textarea's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer rounded-md px-2 py-1.5", i === current && "bg-accent")}
            >
              <div className="truncate font-medium">{p.fullName || p.email}</div>
              <div className="truncate text-xs text-muted-foreground">{p.email}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
