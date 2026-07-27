import { GoogleAuth } from "google-auth-library";

/**
 * Execute the tf-runner Cloud Run Job for one run, passing RUN_ID as a
 * container override. Runs as the job's own service account (runner-sa).
 */
export async function triggerRunnerJob(runId: string): Promise<void> {
  const job = process.env.TF_RUNNER_JOB;
  const project = process.env.GCP_ADMIN_PROJECT_ID;
  const region = process.env.GCP_REGION ?? "us-central1";
  if (!job || !project) {
    throw new Error("TF_RUNNER_JOB and GCP_ADMIN_PROJECT_ID must be set");
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const url = `https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`;
  await client.request({
    url,
    method: "POST",
    data: {
      overrides: {
        containerOverrides: [{ env: [{ name: "RUN_ID", value: runId }] }],
      },
    },
  });
}
