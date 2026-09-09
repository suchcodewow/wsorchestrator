/** The layout for the signed-in app. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return <AppShell session={session}>{children}</AppShell>;
}
