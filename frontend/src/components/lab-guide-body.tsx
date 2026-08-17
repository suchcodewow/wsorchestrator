"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * The rendered guide, plus the one thing the server cannot do: put things on
 * the clipboard.
 *
 * The markup is generated in `@/lib/markdown` and injected as-is. That is safe
 * by construction rather than by trust — the pipeline drops raw HTML from the
 * source and sanitises the author's tree before anything else is added — and
 * it is what keeps the markdown parser and every syntax grammar on the server
 * instead of in the reader's bundle.
 *
 * One delegated listener handles every copy button on the page. The buttons
 * themselves are server-rendered, so a long guide costs one event handler
 * rather than one React component per line of code.
 */
export function LabGuideBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  /**
   * Hold the scroll position across a re-render.
   *
   * New markup replaces the whole subtree, and the browser clamps a scroll
   * offset that no longer fits what is left — so a document that is briefly
   * shorter mid-edit (a fence opened but not yet closed, a section being
   * retyped) drags the reader back up the page. That never comes up on a
   * published guide, which renders once; it comes up constantly in the editor's
   * split view, which re-renders every time the author stops typing.
   *
   * The position is tracked as it changes rather than measured when it is
   * needed: by the time anything here can see new html, the swap has already
   * happened and the old offset is gone. Scroll events are the one reading that
   * arrives early enough, and they cost nothing — no layout is forced, on any
   * render.
   */
  const scroller = useRef<Element | null>(null);
  const scrollTop = useRef(0);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // Whichever ancestor scrolls this content: the split pane's own box in the
    // editor, the page itself on a published guide.
    let node: Element | null = root;
    while (node && !/auto|scroll|overlay/.test(getComputedStyle(node).overflowY))
      node = node.parentElement;

    const target = node ?? document.scrollingElement;
    if (!target) return;
    scroller.current = target;
    scrollTop.current = target.scrollTop;

    // The document's scroll is reported on `document`, not on the element that
    // carries the offset.
    const on: EventTarget = node ?? document;
    const track = () => {
      scrollTop.current = target.scrollTop;
    };
    on.addEventListener("scroll", track, { passive: true });
    return () => on.removeEventListener("scroll", track);
  }, []);

  // Before paint, so the position is put back in the same frame it was lost in
  // and nothing is seen to move. Only when the swap left it *higher* than it
  // was — anything else is a reader who scrolled, and is not ours to undo.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && node.scrollTop < scrollTop.current) {
      node.scrollTop = scrollTop.current;
    }
  }, [html]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // Per-button, so copying a second line while the first is still showing
    // "copied" doesn't cancel the wrong tick.
    const timers = new Map<HTMLElement, number>();

    function flash(button: HTMLElement) {
      button.dataset.copied = "true";
      window.clearTimeout(timers.get(button));
      timers.set(
        button,
        window.setTimeout(() => {
          delete button.dataset.copied;
          timers.delete(button);
        }, 1600),
      );
    }

    /** Everything in `node` except the chrome — line numbers and buttons. */
    function withoutChrome(node: Element): string {
      const clone = node.cloneNode(true) as Element;
      clone.querySelectorAll("[data-nocopy]").forEach((n) => n.remove());
      return clone.textContent ?? "";
    }

    /**
     * The text of a code element, ready for the clipboard.
     *
     * Lines are joined rather than read straight off `textContent`, because the
     * renderer strips the newlines between them — the lines are laid out as
     * blocks, and keeping the newlines as well would double every block's
     * leading (see `@/lib/markdown`). One line, or a block that somehow has no
     * line elements, falls back to reading the node itself.
     */
    function codeText(node: Element): string {
      const lines = node.querySelectorAll(":scope > .line");
      if (lines.length === 0) return withoutChrome(node);

      return Array.from(lines, withoutChrome).join("\n");
    }

    async function copy(text: string) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Older browsers, and any context the async API considers insecure.
        const field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const ok = document.execCommand("copy");
        field.remove();
        return ok;
      }
    }

    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>("[data-copy]");
      if (!button || !root!.contains(button)) return;

      const scope =
        button.dataset.copy === "line"
          ? button.closest(".line")
          : button.closest(".lab-code")?.querySelector("code");
      if (!scope) return;

      void copy(codeText(scope)).then((ok) => ok && flash(button));
    }

    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [html]);

  return (
    <div
      ref={ref}
      className="lab-prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
