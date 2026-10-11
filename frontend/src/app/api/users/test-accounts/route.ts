/**
 * Test accounts (`src/lib/test-accounts.ts`): finding one to view the app as,
 * and making one. Making one creates an account, so it is session-only, as
 * inviting is.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { TEST_ACCOUNT_LIMITS } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canImpersonate } from "@/lib/roles";
import {
  createTestAccount,
  searchTestAccounts,
  suggestTestAccountName,
  testAccountsAllowed,
  type CreateTestAccountError,
} from "@/lib/test-accounts";

const STATUS_FOR: Record<CreateTestAccountError, number> = {
  production: 409,
  forbidden: 403,
  invalid: 400,
  source_not_found: 404,
  platform_source: 409,
};

const postSchema = z.object({
  name: z.string().max(TEST_ACCOUNT_LIMITS.name),
  copyFrom: z.string().trim().min(1).max(200).optional(),
});

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canImpersonate);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const [testAccounts, suggestedName] = await Promise.all([
    searchTestAccounts(params.get("q") ?? ""),
    suggestTestAccountName(params.get("skip") ?? undefined),
  ]);
  return NextResponse.json({ enabled: testAccountsAllowed(), testAccounts, suggestedName });
}

export const POST = audited(async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canImpersonate(session.user.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await createTestAccount(session.user, parsed.data.name, parsed.data.copyFrom);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  return NextResponse.json({ testAccount: result.account }, { status: 201 });
});
