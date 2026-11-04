/**
 * Captain Canary, the coach: a canary in a headset and the team jacket, on
 * the sideline under the lights. The art is the welcome card's picture; the
 * avatar is just the head, beside the coach in a conversation.
 */

import Image from "next/image";
import { cn } from "@/lib/utils";

export function CaptainCanaryArt({ className, title = "Captain Canary" }: { className?: string; title?: string }) {
  return <Image src="/captain-canary.webp" alt={title} width={600} height={600} className={cn("block object-cover object-top", className)} />;
}

export function CaptainCanaryAvatar({ className }: { className?: string }) {
  return <Image src="/captain-canary-avatar.webp" alt="" width={56} height={56} className={cn("block shrink-0 rounded-full object-cover", className)} />;
}
