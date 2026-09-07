import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";

/**
 * The signed-in app.
 *
 * Everything visual is in [[AppShell]], which `/labs` renders too; all this
 * layout adds is the thing that makes the group signed-in — the redirect.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return <AppShell session={session}>{children}</AppShell>;
}
