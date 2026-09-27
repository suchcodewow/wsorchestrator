/** The extra fields this app puts on the Auth.js session. */

import type { DefaultSession } from "next-auth";
import type { Access } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      access: Access;
    } & DefaultSession["user"];
  }
}
