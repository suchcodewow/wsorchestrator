"use client";

/**
 * The header's sign-in link, which returns the visitor to what they were
 * reading.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

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
