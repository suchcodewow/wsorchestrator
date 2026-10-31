/** The Participation tab: the descriptors judges mark, and the net marks each score starts at. */

import { participationSettings } from "@/lib/evals/participation";
import { ParticipationView } from "./participation-view";

export default async function ParticipationPage() {
  return <ParticipationView settings={await participationSettings()} />;
}
