/** Where someone lands when they have signed in but been given no area yet. */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { homePath } from "@/lib/roles";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const home = homePath(session.user.access);
  if (home !== "/welcome") redirect(home);

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Welcome</h1>
        <p className="text-muted-foreground">
          You&apos;re signed in as{" "}
          <span className="font-medium text-foreground">{session.user.email}</span>.
        </p>
      </div>

      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground">
          Your account hasn&apos;t been given access to anything yet. Ask an
          administrator to give you a role, then reload this page.
        </CardContent>
      </Card>
    </div>
  );
}
