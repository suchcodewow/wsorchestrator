import { loadOrgSecrets, log, recordResource, type RunRow } from "./db.js";
import { upsertSecretFile, upsertSecretText } from "./harness.js";
import { openSecret, secretsConfigured } from "./secret-box.js";

/**
 * Copy the site's administrator-managed secrets into a workshop's Harness org.
 *
 * These are the values in Settings → Org Secrets: constants an administrator
 * entered once — a licence key, a shared service account file, an endpoint the
 * workshops all talk to — that every workshop's organization should have. The
 * app stores them sealed and never shows them again; this is the only place they
 * are opened.
 *
 * Run right after the org is created and before the component catalog, so a
 * catalog connector may reference one as `org.<identifier>`: a connector applied
 * before the secret it names would be refused, and the catalog's dependency
 * graph cannot express a dependency on something outside itself.
 *
 * Idempotent like everything else in a provision — `upsertSecretText` and
 * `upsertSecretFile` create or overwrite — so a grown or retried workshop
 * re-confirms what is there, and editing a value in settings reaches existing
 * workshops the next time they are provisioned.
 *
 * Nothing here has a teardown: `deleteOrg` removes the organization with its
 * contents, and these secrets exist nowhere else in a run.
 */
export async function applyOrgSecrets(
  run: RunRow,
  orgId: string,
): Promise<void> {
  const secrets = await loadOrgSecrets();
  if (secrets.length === 0) return;

  // Said once, up front, rather than as N identical failures below. Without a
  // key every row would come back unreadable, and "the deployment has no
  // encryption key" is a different problem from "this row was sealed with an
  // older one" — worth not disguising as the latter.
  if (!secretsConfigured()) {
    await log(
      run.id,
      "system",
      `${secrets.length} org secret(s) skipped — this runner has no ` +
        `HARNESS_TOKEN_ENC_KEY or AUTH_SECRET, so nothing can be decrypted`,
    );
    return;
  }

  await log(
    run.id,
    "system",
    `Applying ${secrets.length} organization secret(s) from site settings`,
  );

  let applied = 0;
  for (const secret of secrets) {
    const value = openSecret(secret.secret);
    if (value === null) {
      // One bad row must not cost the workshop the rest of them. The value was
      // sealed with a different key than this runner holds, and the fix is in
      // the settings page — re-entering it — not in anything a retry would do.
      await log(
        run.id,
        "stderr",
        `org secret ${secret.identifier} skipped — it cannot be decrypted with ` +
          `this deployment's key; re-enter it in Settings → Org Secrets`,
      );
      continue;
    }

    // The identifier doubles as the display name. Harness wants both, and an
    // administrator supplied one string: inventing a prettier name from it
    // would mean the org shows something they never typed.
    if (secret.kind === "file") {
      await upsertSecretFile(orgId, secret.identifier, secret.identifier, value);
    } else {
      await upsertSecretText(orgId, secret.identifier, secret.identifier, value);
    }

    applied += 1;
    await log(
      run.id,
      "stdout",
      `org secret ${secret.identifier} applied` +
        (secret.fileName ? ` (${secret.fileName})` : ""),
    );
  }

  // One counted row rather than one per secret, the same shape the catalog's
  // summary uses: the count is what an organizer needs, and a site with twenty
  // shared secrets would otherwise bury the run page in rows nobody reads.
  await recordResource(run.id, {
    kind: "harness_org_secrets",
    label: "Site org secrets",
    detail:
      applied === secrets.length
        ? `all applied to org ${orgId}`
        : `${secrets.length - applied} could not be decrypted`,
    done: applied,
    total: secrets.length,
  });
}
