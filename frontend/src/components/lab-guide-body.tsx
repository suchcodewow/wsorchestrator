"use client";

/** The rendered guide, with working copy buttons. */

import { useEffect, useLayoutEffect, useRef } from "react";

export function LabGuideBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const scroller = useRef<Element | null>(null);
  const scrollTop = useRef(0);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    let node: Element | null = root;
    while (node && !/auto|scroll|overlay/.test(getComputedStyle(node).overflowY))
      node = node.parentElement;

    const target = node ?? document.scrollingElement;
    if (!target) return;
    scroller.current = target;
    scrollTop.current = target.scrollTop;

    const on: EventTarget = node ?? document;
    const track = () => {
      scrollTop.current = target.scrollTop;
    };
    on.addEventListener("scroll", track, { passive: true });
    return () => on.removeEventListener("scroll", track);
  }, []);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && node.scrollTop < scrollTop.current) {
      node.scrollTop = scrollTop.current;
    }
  }, [html]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

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

    function withoutChrome(node: Element): string {
      const clone = node.cloneNode(true) as Element;
      clone.querySelectorAll("[data-nocopy]").forEach((n) => n.remove());
      return clone.textContent ?? "";
    }

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
