/** What the map and the video library show before a map has been imported. */

import Link from "next/link";

export function MapMissing({ canManage }: { canManage: boolean }) {
  return (
    <div className="max-w-xl rounded-2xl border bg-card p-6 text-sm shadow-sm">
      <p className="font-medium">The map hasn&apos;t been set up yet.</p>
      <p className="mt-1 text-muted-foreground">
        {canManage ? (
          <>
            Import it in{" "}
            <Link href="/mimir-settings/map" className="font-medium text-foreground underline underline-offset-2">
              Mimir Settings → Map
            </Link>
            .
          </>
        ) : (
          "A Training Administrator imports it. Check back soon."
        )}
      </p>
    </div>
  );
}
