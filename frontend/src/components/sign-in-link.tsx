"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * The header's sign-in entry point, which brings the visitor back to whatever
 * they were reading rather than dumping them in the app.
 *
 * A client component only because the current path is the one thing a server
 * component cannot ask for. Only a path is ever put on the query string — the
 * sign-in page re-checks it before handing it to Auth.js, but never building an
 * absolute URL here means there is no origin to get wrong in the first place.
 */
export function SignInLink() {
  const pathname = usePathname();
  const href =
    pathname && pathname !== "/signin"
      ? `/signin?callbackUrl=${encodeURIComponent(pathname)}`
      : "/signin";

  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>Sign in</Link>
    </Button>
  );
}
