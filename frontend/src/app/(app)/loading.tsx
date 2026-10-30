/**
 * A signed-in page still waiting on the server. The shell stays, so a click
 * in the sidebar shows this at once instead of leaving the old page up.
 */

import { GearLoader } from "@/components/gear-loader";

export default function AppLoading() {
  return <GearLoader />;
}
