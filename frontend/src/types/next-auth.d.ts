/** The extra fields this app puts on the Auth.js session. */

import type { DefaultSession } from "next-auth";
import type { SiteRole } from "@/db/schema";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      siteRole: SiteRole;
    } & DefaultSession["user"];
  }
}
