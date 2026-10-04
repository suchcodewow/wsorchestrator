/** A comment's text with the people it tags picked out, the viewer's own tag most of all. */

import { mentionSegments, type MentionPick } from "@/lib/mentions";
import { cn } from "@/lib/utils";

export function MentionText({ text, mentions, viewerEmail }: { text: string; mentions: MentionPick[]; viewerEmail?: string }) {
  const me = viewerEmail?.toLowerCase();
  return (
    <>
      {mentionSegments(text, mentions).map((s, i) =>
        s.mention ? (
          <span
            key={i}
            title={s.mention.email}
            className={cn(
              "rounded px-0.5 font-medium",
              s.mention.email === me ? "bg-brand/15 text-foreground" : "text-brand",
            )}
          >
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
    </>
  );
}
