"use client";

/** An invite, what it grants, and the button that takes it up. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, MailCheck, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type InviteError = "not_found" | "expired" | "revoked";

type Shown =
  | {
      roles: string[];
      invitedBy: string | null;
      alreadyHasAccess: boolean;
    }
  | { error: InviteError };

const ERRORS: Record<InviteError, string> = {
  not_found: "This invite link doesn't exist. Check you copied all of it.",
  expired: "This invite link has expired. Ask whoever sent it for a new one.",
  revoked:
    "This invite link no longer works — whoever made it can't grant those roles any more. Ask an administrator for a new one.",
};

export function InviteView({
  token,
  email,
  home,
  invite,
}: {
  token: string;
  email: string;
  home: string;
  invite: Shown;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unchanged, setUnchanged] = useState(false);

  async function accept() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          ERRORS[body?.error as InviteError] ?? `Could not accept the invite (${res.status})`,
        );
      }
      if (!body.applied) {
        setUnchanged(true);
        setPending(false);
        return;
      }
      router.replace(body.home);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the invite");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">You&apos;ve been invited</h1>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{email}</span>.
        </p>
      </div>

      {"error" in invite ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-5 text-sm">
            <MailX className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>{ERRORS[invite.error]}</span>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid gap-5 py-5 text-sm">
            <div className="flex items-start gap-3">
              <MailCheck className="mt-0.5 size-4 shrink-0 text-brand" />
              <div className="grid gap-2">
                <p>
                  {invite.invitedBy ? (
                    <>
                      <span className="font-medium">{invite.invitedBy}</span> invited you
                    </>
                  ) : (
                    "You've been invited"
                  )}{" "}
                  as:
                </p>
                <ul className="grid gap-1">
                  {invite.roles.map((r) => (
                    <li key={r} className="font-medium text-brand">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {invite.alreadyHasAccess || unchanged ? (
              <div className="grid gap-3">
                <p className="text-muted-foreground">
                  You already have access, so this invite doesn&apos;t change your
                  roles. An administrator can change them on Manage users.
                </p>
                <div>
                  <Button asChild variant="outline">
                    <Link href={home}>Continue</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                {error && (
                  <p role="alert" className="text-destructive">
                    {error}
                  </p>
                )}
                <div>
                  <Button variant="brand" disabled={pending} onClick={() => void accept()}>
                    {pending && <Loader2 className="animate-spin" />}
                    Accept invite
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
