/** The database backups page. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { backupTarget, listBackups } from "@/lib/backups";
import {
  listProductionBackups,
  localRunsHoldingResources,
  productionImportAvailable,
  productionSource,
} from "@/lib/production-import";
import { canManageBackups } from "@/lib/roles";
import { BackupsTable } from "./backups-table";
import { ProductionBackups } from "./production-backups";

export const metadata: Metadata = {
  title: "Backups",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageBackups(session.user.access)) notFound();

  const target = backupTarget();
  const result = await listBackups();

  // QA only: production's backups, which it can import.
  const source = productionSource();
  const [production, holding] =
    productionImportAvailable() && source && target
      ? await Promise.all([listProductionBackups(), localRunsHoldingResources()])
      : [null, []];

  return (
    <BackupsTable
      instance={target?.instance ?? null}
      project={target?.project ?? null}
      initial={result.ok ? result.backups : []}
      error={result.ok ? null : result.error}
    >
      {production && source && target && (
        <ProductionBackups
          source={source}
          instance={target.instance}
          project={target.project}
          region={process.env.GCP_REGION ?? "us-central1"}
          initial={production.ok ? production.backups : []}
          error={production.ok ? null : production.error}
          holding={holding}
        />
      )}
    </BackupsTable>
  );
}
