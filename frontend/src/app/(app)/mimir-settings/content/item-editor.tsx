"use client";

/**
 * Makes or edits one Mimir item: the fields every kind has, the ones its
 * kind adds, and its folded sections in order. An item's kind is fixed once
 * it exists. An edit reaches the coach's next conversation about the item;
 * conversations already under way keep what they started with.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MIMIR_ITEM_LIMITS, MIMIR_KINDS, type MimirAttrs, type MimirKind, type MimirSection } from "@/db/schema";
import {
  KIND_FIELDS,
  KIND_LABELS,
  LIBRARY_KINDS,
  OPTIONAL_PARENT,
  REQUIRED_PARENT,
  coachModeOf,
  type AttrField,
} from "@/lib/mimir/kinds";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  kind: MimirKind;
  parentId: string | null;
  position: number;
  title: string;
  emoji: string;
  color: string;
  summary: string;
  body: string;
  sections: MimirSection[];
  attrs: MimirAttrs;
  updatedAt: string;
};

type SectionDraft = MimirSection & { key: string };

const LIST = "/mimir-settings/content";
const L = MIMIR_ITEM_LIMITS;

const SELECT = cn(
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
);

const ERRORS: Record<string, string> = {
  invalid: "Check the fields: every item needs a title, a colour must be #rrggbb, and every section needs a title.",
  not_found: "That item was removed — go back to the list.",
  bad_parent: "That parent doesn't exist, or this kind of item can't sit under it.",
  kind_fixed: "An item's kind can't change.",
  has_children: "Other items sit under this one. Remove or move them first.",
  taken: "Another item already has that id.",
  forbidden: "Your own role changed — reload the page.",
  impersonating: "You're viewing the app as someone else, so you can't make changes.",
};

let nextKey = 0;
const newKey = () => `s-${nextKey++}`;

export function ItemEditor({ item, holds, kind: initialKind }: { item: Item | null; holds: number; kind: MimirKind }) {
  const router = useRouter();
  const [kind, setKind] = useState<MimirKind>(item?.kind ?? initialKind);
  const [id, setId] = useState("");
  const [parentId, setParentId] = useState(item?.parentId ?? "");
  const [position, setPosition] = useState(String(item?.position ?? 0));
  const [title, setTitle] = useState(item?.title ?? "");
  const [emoji, setEmoji] = useState(item?.emoji ?? "");
  const [color, setColor] = useState(item?.color ?? "");
  const [summary, setSummary] = useState(item?.summary ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [sections, setSections] = useState<SectionDraft[]>((item?.sections ?? []).map((s) => ({ ...s, key: newKey() })));
  const [attrs, setAttrs] = useState<MimirAttrs>(item?.attrs ?? {});
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parentKind = REQUIRED_PARENT[kind] ?? OPTIONAL_PARENT[kind];
  const fields = KIND_FIELDS[kind];

  function moveSection(index: number, by: -1 | 1) {
    setSections((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved!);
      return next;
    });
  }

  async function request(kindOfRequest: "save" | "delete", url: string, init: RequestInit) {
    setBusy(kindOfRequest);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const resBody = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[resBody?.error ?? ""] ?? `Could not save (${res.status}).`);
        return null;
      }
      return resBody ?? {};
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const payload = {
      ...(item ? {} : id.trim() ? { id: id.trim() } : {}),
      kind,
      parentId: parentKind && parentId.trim() ? parentId.trim() : null,
      position: Number.parseInt(position, 10) || 0,
      title,
      emoji,
      color,
      summary,
      body,
      sections: sections.map(({ title: t, content }) => ({ title: t, content })),
      attrs: cleanAttrs(attrs, fields),
    };
    const result = item
      ? await request("save", `/api/mimir/items/${encodeURIComponent(item.id)}`, { method: "PUT", body: JSON.stringify(payload) })
      : await request("save", "/api/mimir/items", { method: "POST", body: JSON.stringify(payload) });
    if (!result) return;
    router.push(`${LIST}?kind=${kind}`);
    router.refresh();
  }

  async function remove() {
    if (!item || !window.confirm(`Remove “${item.title}”? Everyone's progress on it and conversations about it go with it.`)) return;
    const result = await request("delete", `/api/mimir/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!result) return;
    router.push(`${LIST}?kind=${kind}`);
    router.refresh();
  }

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="max-w-3xl space-y-6">
      <motion.div variants={riseChild} className="space-y-4">
        <Link
          href={`${LIST}?kind=${kind}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {KIND_LABELS[kind].many}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h2 className="text-xl font-medium tracking-tight">{item ? item.title : `New ${KIND_LABELS[kind].one.toLowerCase()}`}</h2>
            {item && (
              <p className="text-sm text-muted-foreground">
                <span className="font-mono text-foreground">{item.id}</span> · {KIND_LABELS[item.kind].one}
                {coachModeOf(item.kind) ? " · the coach covers it" : ""}
              </p>
            )}
          </div>
          {item && LIBRARY_KINDS.includes(item.kind) && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/mimir/library/${encodeURIComponent(item.id)}`}>
                <ExternalLink />
                View in library
              </Link>
            </Button>
          )}
        </div>
      </motion.div>

      <motion.div variants={staggerParent(0.03)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <motion.section variants={riseChild} className="space-y-4 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind" htmlFor="mimir-kind">
              <select
                id="mimir-kind"
                value={kind}
                disabled={Boolean(item)}
                onChange={(e) => setKind(e.target.value as MimirKind)}
                className={SELECT}
              >
                {MIMIR_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k].one}
                  </option>
                ))}
              </select>
            </Field>
            {!item && (
              <Field label="Id" htmlFor="mimir-id" hint="Optional. Made from the title when left blank.">
                <Input id="mimir-id" value={id} maxLength={L.id} onChange={(e) => setId(e.target.value.toLowerCase())} />
              </Field>
            )}
            {parentKind && (
              <Field
                label={REQUIRED_PARENT[kind] ? `${KIND_LABELS[parentKind].one} (required)` : `Under ${KIND_LABELS[parentKind].one.toLowerCase()}`}
                htmlFor="mimir-parent"
                hint={`The id of the ${KIND_LABELS[parentKind].one.toLowerCase()} it sits under.`}
              >
                <Input id="mimir-parent" value={parentId} maxLength={L.id} onChange={(e) => setParentId(e.target.value)} />
              </Field>
            )}
            <Field label="Order" htmlFor="mimir-position" hint="Lower comes first.">
              <Input id="mimir-position" type="number" min={0} value={position} onChange={(e) => setPosition(e.target.value)} />
            </Field>
          </div>
          <Field label="Title" htmlFor="mimir-title">
            <Input id="mimir-title" value={title} maxLength={L.title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Emoji" htmlFor="mimir-emoji">
              <Input id="mimir-emoji" value={emoji} maxLength={L.emoji} onChange={(e) => setEmoji(e.target.value)} />
            </Field>
            <Field label="Colour" htmlFor="mimir-color" hint="#rrggbb, or blank.">
              <div className="flex items-center gap-2">
                <Input id="mimir-color" value={color} maxLength={7} onChange={(e) => setColor(e.target.value)} placeholder="#00e3fe" />
                {/^#[0-9a-fA-F]{6}$/.test(color) && <span className="size-6 shrink-0 rounded-md border" style={{ background: color }} />}
              </div>
            </Field>
          </div>
          <Field label={kind === "term" ? "Definition" : "Summary"} htmlFor="mimir-summary">
            <Textarea id="mimir-summary" value={summary} maxLength={L.summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          {kind !== "term" && kind !== "question" && (
            <Field label="Write-up" htmlFor="mimir-body" hint="Markdown. The coach reads this, with the summary and sections.">
              <Textarea
                id="mimir-body"
                value={body}
                maxLength={L.body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-64 font-mono text-xs"
              />
            </Field>
          )}
        </motion.section>

        {fields.length > 0 && (
          <motion.section variants={riseChild} className="space-y-4 px-5 py-4">
            <h3 className="text-sm font-medium">{KIND_LABELS[kind].one} details</h3>
            {fields.map((f) => (
              <AttrInput key={f.key} field={f} attrs={attrs} onChange={setAttrs} />
            ))}
          </motion.section>
        )}

        {sections.map((s, i) => (
          <motion.div key={s.key} variants={riseChild} className="px-5 py-4">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-3">
                <Input
                  aria-label={`Section ${i + 1} title`}
                  placeholder="Section title"
                  value={s.title}
                  maxLength={L.sectionTitle}
                  onChange={(e) => setSections((list) => list.map((x) => (x.key === s.key ? { ...x, title: e.target.value } : x)))}
                />
                <Textarea
                  aria-label={`Section ${i + 1} content`}
                  placeholder="Markdown"
                  value={s.content}
                  maxLength={L.sectionContent}
                  onChange={(e) => setSections((list) => list.map((x) => (x.key === s.key ? { ...x, content: e.target.value } : x)))}
                  className="min-h-32 font-mono text-xs"
                />
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button variant="ghost" size="icon" aria-label={`Move section ${i + 1} up`} disabled={i === 0} onClick={() => moveSection(i, -1)}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move section ${i + 1} down`}
                  disabled={i === sections.length - 1}
                  onClick={() => moveSection(i, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove section ${i + 1}`}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setSections((list) => list.filter((x) => x.key !== s.key))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          </motion.div>
        ))}
        <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3 px-5 py-4">
          <Button
            variant="outline"
            disabled={sections.length >= L.sections}
            onClick={() => setSections((list) => [...list, { key: newKey(), title: "", content: "" }])}
          >
            <Plus />
            Add section
          </Button>
          <span className="text-sm text-muted-foreground">
            {sections.length} {sections.length === 1 ? "section" : "sections"}, shown folded
          </span>
        </motion.div>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="brand" disabled={!title.trim() || busy !== null} onClick={() => void save()}>
          {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
          {item ? "Save" : "Create"}
        </Button>
        {item && (
          <Button
            variant="ghost"
            disabled={busy !== null || holds > 0}
            title={holds > 0 ? "Other items sit under this one" : undefined}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void remove()}
          >
            {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Remove item
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AttrInput({
  field,
  attrs,
  onChange,
}: {
  field: AttrField;
  attrs: MimirAttrs;
  onChange: (next: (a: MimirAttrs) => MimirAttrs) => void;
}) {
  const id = `mimir-attr-${field.key}`;
  const value = attrs[field.key];
  const set = (v: unknown) => onChange((a) => ({ ...a, [field.key]: v }));

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} className="size-3.5 shrink-0 accent-brand" />
        {field.label}
      </label>
    );
  }
  return (
    <Field label={field.label} htmlFor={id} hint={field.hint}>
      {field.type === "textarea" ? (
        <Textarea id={id} value={typeof value === "string" ? value : ""} maxLength={L.attr} onChange={(e) => set(e.target.value)} />
      ) : field.type === "list" ? (
        <Input id={id} value={Array.isArray(value) ? value.join(", ") : ""} onChange={(e) => set(e.target.value.split(","))} />
      ) : field.type === "number" ? (
        <Input id={id} type="number" min={0} value={typeof value === "number" ? value : ""} onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))} />
      ) : (
        <Input id={id} value={typeof value === "string" ? value : ""} maxLength={L.attr} onChange={(e) => set(e.target.value)} />
      )}
    </Field>
  );
}

/** The kind's own attributes, trimmed, with blanks left out; any the kind does not offer are kept as they were. */
function cleanAttrs(attrs: MimirAttrs, fields: AttrField[]): MimirAttrs {
  const out: Record<string, unknown> = { ...attrs };
  for (const f of fields) {
    const v = out[f.key];
    if (f.type === "list") {
      const list = (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean);
      if (list.length) out[f.key] = list;
      else delete out[f.key];
    } else if (typeof v === "string") {
      if (v.trim()) out[f.key] = v.trim();
      else delete out[f.key];
    } else if (v === undefined || v === false || (typeof v === "number" && Number.isNaN(v))) {
      delete out[f.key];
    }
  }
  return out as MimirAttrs;
}
