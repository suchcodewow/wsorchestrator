"use client";

/** The saved Harness tokens, and the deploy and scrub actions on each. */

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { MAX_HARNESS_TOKENS_PER_USER } from "@/db/schema";
import type { DeployChoices } from "@/lib/harness-deploy-choices";
import { administersAccount } from "@/lib/harness-permissions";
import type { HarnessTokenSummary } from "@/lib/harness-tokens";
import { riseChild, staggerParent } from "@/lib/motion";
import { TokenEntryForm } from "./token-entry-form";
import { TokenRow } from "./token-row";
import { useTokenActions } from "./use-token-actions";

export type HarnessTokensViewProps = {
  tokens: HarnessTokenSummary[];
  choices: DeployChoices;
  /** Whether this deployment has the key that encrypts a stored token. */
  configured: boolean;
  /** Whether the viewer may deploy content at all; each token must also administer its account. */
  canDeploy: boolean;
  scrubDays: number;
};

export function HarnessTokensView({ tokens, choices, configured, canDeploy, scrubDays }: HarnessTokensViewProps) {
  const actions = useTokenActions();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { busy } = actions;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <h2 className="text-xl font-medium tracking-tight">Harness tokens</h2>
      </motion.div>

      {!configured && (
        <motion.div
          variants={riseChild}
          role="alert"
          className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>This deployment has no encryption key, so a token cannot be stored safely.</span>
        </motion.div>
      )}

      {actions.error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {actions.error}
        </motion.p>
      )}

      {actions.saved && !actions.error && (
        <motion.p variants={riseChild} role="status" className="text-sm text-brand">
          {actions.saved}
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <TokenEntryForm
          disabled={!configured}
          full={tokens.length >= MAX_HARNESS_TOKENS_PER_USER}
          saving={busy === "save"}
          onSave={actions.save}
        />
      </motion.div>

      <motion.div variants={riseChild}>
        {tokens.length === 0 ? (
          <p className="rounded-2xl border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">
            No tokens saved yet.
          </p>
        ) : (
          <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
            {tokens.map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                choices={choices}
                busy={{
                  row: busy === `row:${t.id}`,
                  deploying: busy === `deploy:${t.id}`,
                  scrubbing: busy === `scrub:${t.id}`,
                }}
                canDeploy={canDeploy && administersAccount(t.permissions)}
                scrubDays={scrubDays}
                expanded={expanded === t.id}
                onToggle={() => setExpanded((current) => (current === t.id ? null : t.id))}
                onRecheck={() => actions.recheck(t.id)}
                onRemove={() => actions.remove(t.id)}
                onDeploy={(org, selection) => actions.deploy(t.id, org, selection)}
                onScrub={() => actions.scrub(t.id)}
              />
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
