"use client";

/**
 * Draws one of a presentation's own pages at whatever size its box is: the
 * stage is 1920×1080 and everything on it, text and outlines included, is
 * sized in container-query units, so it scales the same in the full-screen
 * player, the speaker-notes tab, a thumbnail and the editor. A converted
 * slide's background picture lies under everything. Elements not yet revealed
 * are hidden, and arrive with their reveal's effect; an element whose click
 * reveals something is clickable when `onTrigger` is given; an element with a
 * border effect has it drawn round its edge.
 */

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { motion, type TargetAndTransition } from "framer-motion";
import {
  isShown,
  STAGE,
  triggers,
  type Font,
  type PageDocument,
  type PageElement,
  type RevealEffect,
  type RevealState,
} from "@/lib/presentations/page";
import { cn } from "@/lib/utils";
import { BorderEffect, ElectricFilter } from "./border-effect";

/** `n` stage pixels, as a share of the stage's width. */
export const cq = (n: number) => `${(n / STAGE.width) * 100}cqw`;

export const FONT_STACKS: Record<Font, string> = {
  sans: "var(--font-sans), system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "var(--font-mono), ui-monospace, monospace",
};

export const assetUrl = (presentationId: string, assetId: string) => `/api/presentations/${presentationId}/assets/${assetId}`;

const HIDDEN: Record<RevealEffect, TargetAndTransition> = {
  appear: { opacity: 0 },
  fade: { opacity: 0 },
  rise: { opacity: 0, y: "25%" },
  zoom: { opacity: 0, scale: 0.6 },
  wipe: { opacity: 1, clipPath: "inset(0 100% 0 0)" },
};

const SHOWN: TargetAndTransition = { opacity: 1, y: "0%", scale: 1, clipPath: "inset(0 0% 0 0)" };

const DURATION: Record<RevealEffect, number> = { appear: 0, fade: 0.5, rise: 0.5, zoom: 0.45, wipe: 0.6 };

/** Where an element sits on the stage, as shares of it. */
export function placement(el: Pick<PageElement, "x" | "y" | "w" | "h" | "rotation">): CSSProperties {
  return {
    position: "absolute",
    left: `${(el.x / STAGE.width) * 100}%`,
    top: `${(el.y / STAGE.height) * 100}%`,
    width: `${(el.w / STAGE.width) * 100}%`,
    height: `${(el.h / STAGE.height) * 100}%`,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

/** The stage's drawn width over its full width, kept up to date; only the electric effect needs it. */
function useStageScale(watch: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!watch || !el) return;
    const observer = new ResizeObserver(([entry]) => entry && setScale(entry.contentRect.width / STAGE.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [watch]);
  return { ref, scale };
}

/** An element's corners; a picture has them too, so a cut-out card and the effect round it can follow the card's. */
const radiusOf = (el: PageElement) => (el.kind === "ellipse" ? "50%" : cq(el.radius));

export function PageView({
  presentationId,
  document: doc,
  state,
  onTrigger,
  ghostHidden,
  className,
  children,
}: {
  presentationId: string;
  document: PageDocument;
  /** How far the page's reveals have gone; "all" shows everything, as a thumbnail does. */
  state: RevealState | "all";
  onTrigger?: (elementId: string) => void;
  /** Shows hidden elements faintly instead of not at all, for the editor. */
  ghostHidden?: boolean;
  className?: string;
  /** Drawn over the stage, in the same box: the editor's selection. */
  children?: React.ReactNode;
}) {
  const clickable = onTrigger ? triggers(doc) : new Set<string>();
  const electric = doc.elements.some((el) => el.border?.effect === "electric");
  const { ref, scale } = useStageScale(electric);
  const filterId = `electric-${useId().replace(/:/g, "")}`;
  return (
    <div
      ref={ref}
      className={cn("relative aspect-video w-full overflow-hidden select-none", className)}
      style={{ background: doc.background, containerType: "inline-size" }}
    >
      {electric && <ElectricFilter id={filterId} scale={scale} />}
      {doc.backgroundImage && (
        // eslint-disable-next-line @next/next/no-img-element -- a converted slide's background, served by the app's own route
        <img src={assetUrl(presentationId, doc.backgroundImage)} alt="" draggable={false} className="absolute inset-0 size-full" />
      )}
      {doc.elements.map((el) => {
        const shown = state === "all" || isShown(doc, el, state);
        const effect = el.reveal?.effect ?? "appear";
        const trigger = clickable.has(el.id);
        return (
          // Where clicks reveal, only the triggers take them: a click on an answer lying over its card reaches the card.
          <div
            key={el.id}
            style={placement(el)}
            className={cn(onTrigger && !trigger && "pointer-events-none")}
            data-element={el.id}
            data-shown={shown}
          >
            <motion.div
              initial={false}
              animate={shown ? SHOWN : ghostHidden ? { opacity: 0.3 } : HIDDEN[effect]}
              transition={{ duration: shown ? DURATION[effect] : 0.2, ease: "easeOut" }}
              className={cn("relative size-full", trigger && "cursor-pointer transition-[filter] hover:brightness-110")}
              onClick={
                trigger
                  ? (e) => {
                      e.stopPropagation();
                      onTrigger!(el.id);
                    }
                  : undefined
              }
              role={trigger ? "button" : undefined}
              aria-label={trigger ? el.text || "Reveal" : undefined}
            >
              {el.kind === "image" ? (
                el.src && (
                  // eslint-disable-next-line @next/next/no-img-element -- an element cut from a converted slide, served by the app's own route
                  <img
                    src={assetUrl(presentationId, el.src)}
                    alt=""
                    draggable={false}
                    className="size-full"
                    style={{ borderRadius: radiusOf(el) }}
                  />
                )
              ) : (
                <ElementBody el={el} />
              )}
              {el.border && <BorderEffect effect={el.border.effect} color={el.border.color} radius={radiusOf(el)} filterId={filterId} />}
            </motion.div>
          </div>
        );
      })}
      {children}
    </div>
  );
}

function ElementBody({ el }: { el: PageElement }) {
  const justify = { left: "flex-start", center: "center", right: "flex-end" }[el.align];
  const items = { top: "flex-start", middle: "center", bottom: "flex-end" }[el.valign];
  return (
    <div
      className="flex size-full overflow-hidden"
      style={{
        background: el.fill ?? "transparent",
        border: el.stroke && el.strokeWidth > 0 ? `${cq(el.strokeWidth)} solid ${el.stroke}` : undefined,
        borderRadius: radiusOf(el),
        justifyContent: justify,
        alignItems: items,
        padding: cq(el.kind === "text" ? 8 : 24),
        color: el.textColor,
        fontFamily: FONT_STACKS[el.font],
        fontSize: cq(el.fontSize),
        fontWeight: el.bold ? 700 : 400,
        lineHeight: 1.2,
      }}
    >
      {el.text && (
        <span className="wrap-break-word whitespace-pre-wrap" style={{ textAlign: el.align, maxWidth: "100%" }}>
          {el.text}
        </span>
      )}
    </div>
  );
}
