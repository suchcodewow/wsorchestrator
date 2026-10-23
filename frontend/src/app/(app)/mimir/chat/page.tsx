/** The coach: it reviews what you have mastered, recommends the next concept, and checks what you know of it. */

import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { getMap } from "@/lib/mimir/map/content";
import { getCoachChat } from "@/lib/mimir/map/coach";
import { conceptsInOrder } from "@/lib/mimir/map/schema";
import { getProfile } from "@/lib/mimir/progress";
import { canManageEvalsSettings, canManageMimir } from "@/lib/roles";
import { ChatView } from "./chat-view";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const [chat, profile, map] = await Promise.all([getCoachChat(session.user.id), getProfile(session.user.id), getMap()]);
  if (!chat.hasMap || !map) {
    return (
      <div className="max-w-xl rounded-2xl border bg-card p-6 text-sm shadow-sm">
        <p className="font-medium">The coach has nothing to teach yet.</p>
        <p className="mt-1 text-muted-foreground">
          {canManageMimir(session.user.access) ? (
            <>
              Import the map in{" "}
              <Link href="/mimir-settings/map" className="font-medium text-foreground underline underline-offset-2">
                Mimir Settings → Map
              </Link>{" "}
              first.
            </>
          ) : (
            "A Training Administrator sets up the course. Check back soon."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div role="note" className="mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-brand-border/60 bg-brand/5 px-5 py-4 text-sm">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-brand" />
        <p>
          <span className="font-medium">October 2026: Mimir is in preview.</span> It can make mistakes so please double-check answers. Please use the
          feedback buttons in videos to help us improve it. Thanks!
        </p>
      </div>
      <ChatView
        initial={{
          configured: chat.configured,
          conversation: chat.conversation && {
            messages: chat.conversation.messages.map((m) => ({ ...m, at: m.at.toISOString() })),
            earlier: chat.conversation.earlier,
          },
          needsGreeting: chat.needsGreeting,
          progress: chat.progress,
        }}
        concepts={conceptsInOrder(map.content).map((c) => ({ id: c.id, name: c.name, hasVideo: Boolean(c.video) }))}
        profile={{ role: profile.role, coachStyle: profile.coachStyle }}
        canSeePoints={canManageEvalsSettings(session.user.access)}
      />
    </div>
  );
}
