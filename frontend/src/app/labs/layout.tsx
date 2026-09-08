/** The layout for the whole /labs subtree. */

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";

export default async function LabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <AppShell session={session} scroll="document">
      {children}
    </AppShell>
  );
}
