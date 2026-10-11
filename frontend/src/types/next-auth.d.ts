/** The extra fields this app puts on the Auth.js session. */

import type { DefaultSession } from "next-auth";
import type { Access } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      access: Access;
    } & DefaultSession["user"];
    /**
     * The platform administrator really signed in, while they view the app
     * as `user` (`src/lib/impersonation.ts`); absent otherwise. `testAccount`
     * is set when `user` is a test account, so changes made as it go through
     * (`src/lib/test-accounts.ts`).
     */
    impersonator?: { id: string; name: string | null; email: string | null; testAccount?: true };
  }
}
