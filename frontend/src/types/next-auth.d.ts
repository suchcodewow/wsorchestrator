import type { DefaultSession } from "next-auth";
import type { SiteRole } from "@/db/schema";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** Site role, read from the user row on every request. */
      siteRole: SiteRole;
    } & DefaultSession["user"];
  }
}
