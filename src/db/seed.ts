import "dotenv/config";
import { db } from "./index";
import { workshops } from "./schema";

const SAMPLES = [
  {
    slug: "gke-starter",
    title: "GKE Starter Cluster",
    description:
      "Provisions a fresh project with a small GKE Autopilot cluster and an Artifact Registry repo.",
    icon: "boxes",
    tfSource: "modules/gke-starter",
    ttlSeconds: 3600,
  },
  {
    slug: "artifact-registry",
    title: "Artifact Registry Sandbox",
    description:
      "A lightweight project with a Docker Artifact Registry repository and IAM wired for pushes.",
    icon: "package",
    tfSource: "modules/artifact-registry",
    ttlSeconds: 3600,
  },
  {
    slug: "cloud-run-demo",
    title: "Cloud Run Demo",
    description:
      "Deploys a sample container to Cloud Run behind a public URL in a throwaway project.",
    icon: "cloud",
    tfSource: "modules/cloud-run-demo",
    ttlSeconds: 3600,
  },
];

async function main() {
  for (const w of SAMPLES) {
    await db
      .insert(workshops)
      .values(w)
      .onConflictDoNothing({ target: workshops.slug });
    console.log(`seeded: ${w.slug}`);
  }
  console.log("done");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
