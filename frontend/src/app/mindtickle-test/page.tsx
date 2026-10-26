/** A public frame to try Mindtickle's postMessage identity handshake. */

import type { Metadata } from "next";
import { MindtickleTest } from "./mindtickle-test";

export const metadata: Metadata = { title: "Mindtickle test — Harness Events" };

export default function MindtickleTestPage() {
  return <MindtickleTest />;
}
