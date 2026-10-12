/**
 * The cohort test group: who is in it, the suffix its channels and meetings
 * carry, and whether it is on. Any Training user may read it, so the Cohorts
 * page can warn that it is on; only a platform administrator changes it.
 * Turning it off archives its Slack channels and cancels its calendar invites.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { TEST_GROUP_MAX_MEMBERS } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getTestGroup, saveTestGroup } from "@/lib/cohorts/test-group";
import { dedupeMembers, testGroupSlug } from "@/lib/cohorts/test-group-plan";
import { takeDownTestGroup } from "@/lib/cohorts/test-group-teardown";
import { canManageTestGroup, canUseTraining } from "@/lib/roles";

const bodySchema = z
  .object({
    on: z.boolean().optional(),
    suffix: z.string().max(100).optional(),
    members: z
      .array(
        z
          .object({
            email: z.string().trim().email().max(320),
            fullName: z.string().trim().max(200),
          })
          .strict(),
      )
      .max(TEST_GROUP_MAX_MEMBERS)
      .optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.on !== undefined || b.suffix !== undefined || b.members !== undefined,
    "nothing to change",
  );

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;
  return NextResponse.json(await getTestGroup());
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageTestGroup);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { on, members } = parsed.data;
  const suffix =
    parsed.data.suffix === undefined
      ? undefined
      : testGroupSlug(parsed.data.suffix);

  const before = await getTestGroup();
  const after = {
    on: on ?? before.on,
    suffix: suffix ?? before.suffix,
    members: members ? dedupeMembers(members) : before.members,
  };
  // A name without a suffix would be the real cohort's own, so the group cannot be on without one, or without anyone in it.
  if (after.on && !after.suffix)
    return NextResponse.json({ error: "suffix_required" }, { status: 400 });
  if (after.on && after.members.length === 0)
    return NextResponse.json({ error: "members_required" }, { status: 400 });
  // Changing the suffix while on would strand the channels made under the old one.
  if (before.on && after.on && after.suffix !== before.suffix) {
    return NextResponse.json({ error: "suffix_locked" }, { status: 409 });
  }

  let teardown: Awaited<ReturnType<typeof takeDownTestGroup>> | null = null;
  if (before.on && !after.on) {
    teardown = await takeDownTestGroup();
    if (!teardown.ok) {
      noteAudit({
        target: "test_group",
        targetLabel: "Turn off failed",
        detail: { failures: teardown.failures },
      });
      return NextResponse.json(
        { error: "teardown_failed", failures: teardown.failures },
        { status: 502 },
      );
    }
  }
  await saveTestGroup(user.id, {
    on: after.on,
    suffix: after.suffix,
    members: after.members,
  });

  noteAudit({
    target: "test_group",
    targetLabel: [
      on !== undefined && `Test group ${on ? "on" : "off"}`,
      suffix !== undefined && `suffix “${after.suffix}”`,
      members &&
        `${after.members.length} ${after.members.length === 1 ? "person" : "people"}`,
    ]
      .filter(Boolean)
      .join(", "),
    detail: teardown
      ? { archived: teardown.archived, cancelled: teardown.cancelled }
      : undefined,
  });
  return NextResponse.json({
    ...(await getTestGroup()),
    ...(teardown
      ? { archived: teardown.archived, cancelled: teardown.cancelled }
      : {}),
  });
});
