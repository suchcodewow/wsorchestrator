/** A concept's chat button: opens the Chat tab and asks the coach to switch to this concept. A green check sits on it once the concept is mastered. */

import Link from "next/link";
import { Check, MessageCircle } from "lucide-react";
import type { PlacedConcept } from "@/lib/mimir/map/layout";
import type { ConceptState } from "@/lib/mimir/map/schema";

/** Where the chat button goes: the Chat tab, which asks the coach to switch to the concept and takes the parameter off the address. */
export const askLink = (conceptId: string) => `/coach-canary/chat?ask=${encodeURIComponent(conceptId)}`;

export function ChatButton({ concept: c, state: st, size }: { concept: PlacedConcept; state: ConceptState; size: number }) {
  const what = st.mastered ? "Mastered. Talk it over again with the coach" : "Talk it over with the coach";
  return (
    <Link
      href={askLink(c.id)}
      className="mm-play mm-chat"
      style={{ "--lc": `var(--l${c.level})`, width: size, height: size } as React.CSSProperties}
      title={what}
      aria-label={`${what}: ${c.name}`}
      onClick={(e) => e.stopPropagation()}
    >
      <MessageCircle style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.5} aria-hidden />
      {st.mastered && (
        <span className="mm-chat-done" aria-hidden>
          <Check className="size-2.5" strokeWidth={4} />
        </span>
      )}
    </Link>
  );
}
