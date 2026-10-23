import { Annoyed, Smile } from "lucide-react";
import type { VideoFeedbackRating } from "@/db/schema";
import { cn } from "@/lib/utils";

/** What each stored rating is called to a person: "up" is a smiley, "down" is confused. */
export const RATING_LABELS: Record<VideoFeedbackRating, string> = {
  up: "Smiley face",
  down: "Confused face",
};

/** The face for a rating, in the color it is shown in on a plain background. */
export const RATING_TEXT_TONES: Record<VideoFeedbackRating, string> = {
  up: "text-green-600",
  down: "text-orange-500",
};

export function RatingFace({
  rating,
  className,
  ...props
}: { rating: VideoFeedbackRating } & React.ComponentProps<"svg">) {
  const Face = rating === "up" ? Smile : Annoyed;
  return <Face className={cn(className)} {...props} />;
}
