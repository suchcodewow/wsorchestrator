"use client";

/**
 * What the page editor shows beside the stage: the selected element's text,
 * look, place and reveal, or with nothing selected, the page's background and
 * a count of its reveals.
 */

import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  BORDER_EFFECT_LABELS,
  BORDER_EFFECTS,
  FONT_LABELS,
  FONTS,
  MAX_ENTRY_DELAY_MS,
  REVEAL_EFFECT_LABELS,
  REVEAL_EFFECTS,
  revealSteps,
  triggers,
  type BorderEffect,
  type PageDocument,
  type PageElement,
  type Reveal,
  type RevealEffect,
} from "@/lib/presentations/page";
import { cn } from "@/lib/utils";

const SELECT =
  "h-8 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** How far apart on-entry reveals added one after another start. */
const ENTRY_STAGGER_MS = 400;

const KIND_LABELS: Record<PageElement["kind"], string> = { rect: "Rectangle", ellipse: "Ellipse", text: "Text", image: "Picture" };

/** How an element is named in a list of them: its kind, and the start of its text, or its place in the stack when it has none. */
export function elementLabel(el: PageElement, doc: PageDocument): string {
  const text = el.text.trim().split("\n")[0]!.slice(0, 28);
  return text ? `${KIND_LABELS[el.kind]}: ${text}` : `${KIND_LABELS[el.kind]} ${doc.elements.indexOf(el) + 1}`;
}

export type ElementChange = (patch: Partial<PageElement>, key: string) => void;

export function ElementPanel({
  document: doc,
  element: el,
  onChange,
  onLayer,
  onDuplicate,
  onDelete,
}: {
  document: PageDocument;
  element: PageElement;
  onChange: ElementChange;
  onLayer: (to: "front" | "back") => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const set = (patch: Partial<PageElement>, field: string) => onChange(patch, `${field}:${el.id}`);
  const others = doc.elements.filter((o) => o.id !== el.id);

  function setReveal(on: Reveal["on"] | "none") {
    const effect: RevealEffect = el.reveal?.effect ?? "fade";
    if (on === "none") set({ reveal: null }, "reveal");
    if (on === "enter") {
      // After the last one already entering, so a few added in turn arrive in turn.
      const latest = Math.max(-ENTRY_STAGGER_MS, ...doc.elements.flatMap((o) => (o.reveal?.on === "enter" ? [o.reveal.delay] : [])));
      set({ reveal: { on: "enter", delay: Math.min(latest + ENTRY_STAGGER_MS, MAX_ENTRY_DELAY_MS), effect } }, "reveal");
    }
    if (on === "next") {
      const highest = Math.max(0, ...doc.elements.flatMap((o) => (o.reveal?.on === "next" ? [o.reveal.order] : [])));
      set({ reveal: { on: "next", order: highest + 1, effect } }, "reveal");
    }
    if (on === "click" && others[0]) set({ reveal: { on: "click", by: others[0].id, effect } }, "reveal");
  }

  return (
    <div className="divide-y rounded-lg border bg-card text-sm">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="font-medium">{KIND_LABELS[el.kind]}</p>
        <div className="flex">
          <Button variant="ghost" size="icon" aria-label="Bring to front" onClick={() => onLayer("front")}>
            <ArrowUpToLine />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Send to back" onClick={() => onLayer("back")}>
            <ArrowDownToLine />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Duplicate" onClick={onDuplicate}>
            <Copy />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete element" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>

      {el.kind !== "image" && (
        <>
          <div className="space-y-2 px-4 py-3">
            <Textarea
              aria-label="Text"
              value={el.text}
              rows={3}
              placeholder={el.kind === "text" ? "Text" : "Text on the shape"}
              onChange={(e) => set({ text: e.target.value }, "text")}
            />
            <div className="grid grid-cols-[1fr_4.5rem] gap-2">
              <select
                aria-label="Font"
                className={SELECT}
                value={el.font}
                onChange={(e) => set({ font: e.target.value as PageElement["font"] }, "font")}
              >
                {FONTS.map((f) => (
                  <option key={f} value={f}>
                    {FONT_LABELS[f]}
                  </option>
                ))}
              </select>
              <NumberInput label="Font size" value={el.fontSize} min={8} max={400} onChange={(fontSize) => set({ fontSize }, "fontSize")} />
            </div>
            <div className="flex items-center gap-1">
              <ColorInput label="Text colour" value={el.textColor} onChange={(textColor) => set({ textColor }, "textColor")} />
              <Toggle label="Bold" on={el.bold} onClick={() => set({ bold: !el.bold }, "bold")}>
                <Bold />
              </Toggle>
              <span className="mx-1 h-5 w-px bg-border" />
              {(["left", "center", "right"] as const).map((align) => (
                <Toggle key={align} label={`Align ${align}`} on={el.align === align} onClick={() => set({ align }, "align")}>
                  {align === "left" ? <AlignLeft /> : align === "center" ? <AlignCenter /> : <AlignRight />}
                </Toggle>
              ))}
              <select
                aria-label="Vertical alignment"
                className={cn(SELECT, "ml-1 w-24")}
                value={el.valign}
                onChange={(e) => set({ valign: e.target.value as PageElement["valign"] }, "valign")}
              >
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 px-4 py-3">
            <Row label="Fill">
              <ColorInput
                label="Fill colour"
                value={el.fill ?? "#ffffff"}
                disabled={el.fill === null}
                onChange={(fill) => set({ fill }, "fill")}
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={el.fill === null}
                  onChange={(e) => set({ fill: e.target.checked ? null : "#1f6feb" }, "fill")}
                />
                None
              </label>
            </Row>
            <Row label="Outline">
              <ColorInput
                label="Outline colour"
                value={el.stroke ?? "#111111"}
                onChange={(stroke) => set({ stroke, strokeWidth: el.strokeWidth || 4 }, "stroke")}
              />
              <NumberInput
                label="Outline width"
                value={el.stroke ? el.strokeWidth : 0}
                min={0}
                max={80}
                onChange={(strokeWidth) => set({ strokeWidth, stroke: strokeWidth > 0 ? (el.stroke ?? "#111111") : null }, "strokeWidth")}
              />
            </Row>
            {el.kind === "rect" && (
              <Row label="Corners">
                <NumberInput label="Corner radius" value={el.radius} min={0} max={540} onChange={(radius) => set({ radius }, "radius")} />
              </Row>
            )}
          </div>
        </>
      )}

      <div className="grid grid-cols-4 gap-2 px-4 py-3">
        <NumberInput label="X" value={el.x} min={-1920} max={3840} onChange={(x) => set({ x }, "x")} showLabel />
        <NumberInput label="Y" value={el.y} min={-1920} max={3840} onChange={(y) => set({ y }, "y")} showLabel />
        <NumberInput label="W" value={el.w} min={1} max={3840} onChange={(w) => set({ w }, "w")} showLabel />
        <NumberInput label="H" value={el.h} min={1} max={3840} onChange={(h) => set({ h }, "h")} showLabel />
        <NumberInput
          label="Rotate"
          value={el.rotation}
          min={-360}
          max={360}
          onChange={(rotation) => set({ rotation }, "rotation")}
          showLabel
        />
        {el.kind === "image" && (
          <NumberInput label="Corners" value={el.radius} min={0} max={540} onChange={(radius) => set({ radius }, "radius")} showLabel />
        )}
      </div>

      <div className="space-y-2 px-4 py-3">
        <Row label="Reveal">
          <select
            aria-label="Reveal"
            className={SELECT}
            value={el.reveal?.on ?? "none"}
            onChange={(e) => setReveal(e.target.value as Reveal["on"] | "none")}
          >
            <option value="none">Always shown</option>
            <option value="enter">On entry</option>
            <option value="next">On next</option>
            <option value="click" disabled={others.length === 0}>
              On click of…
            </option>
          </select>
        </Row>
        {el.reveal?.on === "enter" && (
          <Row label="After (ms)">
            <NumberInput
              label="Delay after the page appears, in milliseconds"
              value={el.reveal.delay}
              min={0}
              max={MAX_ENTRY_DELAY_MS}
              onChange={(delay) => set({ reveal: { ...(el.reveal as Extract<Reveal, { on: "enter" }>), delay } }, "delay")}
            />
          </Row>
        )}
        {el.reveal?.on === "next" && (
          <Row label="Order">
            <NumberInput
              label="Reveal order"
              value={el.reveal.order}
              min={1}
              max={999}
              onChange={(order) => set({ reveal: { ...(el.reveal as Extract<Reveal, { on: "next" }>), order } }, "order")}
            />
          </Row>
        )}
        {el.reveal?.on === "click" && (
          <Row label="Clicked">
            <select
              aria-label="Element that reveals it"
              className={SELECT}
              value={el.reveal.by}
              onChange={(e) => set({ reveal: { ...(el.reveal as Extract<Reveal, { on: "click" }>), by: e.target.value } }, "by")}
            >
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {elementLabel(o, doc)}
                </option>
              ))}
            </select>
          </Row>
        )}
        {el.reveal && (
          <Row label="Effect">
            <select
              aria-label="Reveal effect"
              className={SELECT}
              value={el.reveal.effect}
              onChange={(e) => set({ reveal: { ...el.reveal!, effect: e.target.value as RevealEffect } }, "effect")}
            >
              {REVEAL_EFFECTS.map((effect) => (
                <option key={effect} value={effect}>
                  {REVEAL_EFFECT_LABELS[effect]}
                </option>
              ))}
            </select>
          </Row>
        )}
      </div>

      <BorderRow el={el} set={set} />
    </div>
  );
}

function BorderRow({ el, set }: { el: PageElement; set: (patch: Partial<PageElement>, field: string) => void }) {
  return (
    <div className="space-y-2 px-4 py-3">
      <Row label="Border">
        <select
          aria-label="Border effect"
          className={SELECT}
          value={el.border?.effect ?? "none"}
          onChange={(e) =>
            set(
              {
                border: e.target.value === "none" ? null : { effect: e.target.value as BorderEffect, color: el.border?.color ?? "#5ad8ff" },
              },
              "border",
            )
          }
        >
          <option value="none">None</option>
          {BORDER_EFFECTS.map((effect) => (
            <option key={effect} value={effect}>
              {BORDER_EFFECT_LABELS[effect]}
            </option>
          ))}
        </select>
        {el.border && (
          <ColorInput
            label="Border colour"
            value={el.border.color}
            onChange={(color) => set({ border: { ...el.border!, color } }, "borderColor")}
          />
        )}
      </Row>
    </div>
  );
}

/** The page itself, with nothing selected: its background, and what its reveals add up to. */
export function PagePanel({ document: doc, onBackground }: { document: PageDocument; onBackground: (color: string) => void }) {
  const steps = revealSteps(doc).length;
  const clickers = triggers(doc).size;
  const entering = doc.elements.filter((el) => el.reveal?.on === "enter").length;
  return (
    <div className="divide-y rounded-lg border bg-card text-sm">
      <p className="px-4 py-2 font-medium">Page</p>
      <div className="px-4 py-3">
        <Row label="Background">
          <ColorInput label="Background colour" value={doc.background} onChange={onBackground} />
          <span className="font-mono text-xs text-muted-foreground">{doc.background}</span>
        </Row>
      </div>
      <p className="px-4 py-2.5 text-muted-foreground">
        {doc.elements.length} {doc.elements.length === 1 ? "element" : "elements"} · {steps} {steps === 1 ? "press" : "presses"} to reveal ·{" "}
        {clickers} {clickers === 1 ? "element" : "elements"} to click
        {entering > 0 && ` · ${entering} on entry`}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

function ColorInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (color: string) => void;
}) {
  return (
    <input
      type="color"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-field p-0.5 disabled:opacity-40"
    />
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
  showLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  showLabel?: boolean;
}) {
  const input = (
    <Input
      type="number"
      aria-label={label}
      value={Math.round(value)}
      min={min}
      max={max}
      className="h-8 px-2 tabular-nums"
      onChange={(e) => {
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
    />
  );
  if (!showLabel) return input;
  return (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {input}
    </label>
  );
}

function Toggle({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={on ? "secondary" : "ghost"} size="icon" className="size-8" aria-label={label} aria-pressed={on} onClick={onClick}>
      {children}
    </Button>
  );
}
