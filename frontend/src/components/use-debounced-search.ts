"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

/** How long a search box waits after the last keystroke before it queries. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * A search box's text, handed to `onSearch` once typing pauses. `value` is the
 * search the page was last queried with: when it changes underneath the box
 * (back button, a link) the box follows it rather than searching again.
 */
export function useDebouncedSearch(value: string, onSearch: (q: string) => void) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  const search = useEffectEvent(onSearch);

  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    const q = text.trim();
    if (q === sent.current) return;
    const t = setTimeout(() => {
      sent.current = q;
      search(q);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  return [text, setText] as const;
}
