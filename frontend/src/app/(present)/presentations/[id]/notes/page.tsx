/**
 * A presentation's speaker notes, in a tab of its own beside the full-screen
 * player: the current slide, the next, and the notes. It sits outside the
 * app's shell so the whole window is the presenter's.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { getPresentation } from "@/lib/presentations/presentations";
import { canUseTraining } from "@/lib/roles";
import { SpeakerNotes } from "./speaker-notes";

export const metadata: Metadata = { title: "Speaker notes" };

export default async function SpeakerNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const presentation = await getPresentation((await params).id);
  if (!presentation) notFound();
  return <SpeakerNotes id={presentation.id} name={presentation.name} slides={presentation.slides} pages={presentation.pages} />;
}
