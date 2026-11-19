/** The Superlatives tab: the standing list every Bootcamp's superlatives survey asks its class. */

import { getSuperlativeList } from "@/lib/surveys/superlatives";
import { SuperlativesEditor } from "./superlatives-editor";

export const dynamic = "force-dynamic";

export default async function SuperlativesSettingsPage() {
  return <SuperlativesEditor list={await getSuperlativeList()} />;
}
