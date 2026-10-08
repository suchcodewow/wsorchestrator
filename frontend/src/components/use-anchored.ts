"use client";

/**
 * A suggestion list held to the field it belongs to: the list's parent — the
 * `relative` box around the field — is its anchor, and `anchorFloating` keeps
 * it below the field, or above it when there is no room below, as wide as the
 * field and no taller than the room there is. It stays in place in the DOM,
 * so inside a dialog it is still part of the dialog.
 */

import { useLayoutEffect, useRef } from "react";
import { anchorFloating, type FloatingOptions } from "@/lib/floating";

/** Give the list `absolute top-0 left-0` and this ref; it is placed while `open`. */
export function useAnchoredToParent<T extends HTMLElement>(open: boolean, options: FloatingOptions = {}) {
  const ref = useRef<T>(null);
  const { placement, gap = 4, maxHeight = 256 } = options;
  useLayoutEffect(() => {
    const list = ref.current;
    const anchor = list?.parentElement;
    if (!open || !list || !anchor) return;
    return anchorFloating(anchor, list, { strategy: "absolute", matchWidth: true, placement, gap, maxHeight });
  }, [open, placement, gap, maxHeight]);
  return ref;
}
