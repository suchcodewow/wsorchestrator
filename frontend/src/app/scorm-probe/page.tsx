/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * A public page the SCORM shell frames inside Mindtickle.
 */

import type { Metadata } from "next";
import { ScormProbe } from "./scorm-probe";

export const metadata: Metadata = { title: "SCORM probe — Harness Events" };

export default function ScormProbePage() {
  return <ScormProbe />;
}
