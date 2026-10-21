/**
 * The Dietary needs tab, for everyone, or the Bootcamp or Intermediate group
 * alone (`stage`): what was marked critical, then what was not, each with who
 * wrote in "Other"; then who has yet to register.
 */

import {
  CRITICAL_WRITE_IN_PREFIX,
  UNREGISTERED_LIST,
  UNREGISTERED_PREFIX,
  WRITE_IN_LIST,
  WRITE_IN_PREFIX,
  dietaryStageOf,
} from "@/lib/list-specs";
import { dietaryCounts, listUnregistered, listWriteIns } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { DietaryView } from "./dietary-view";

export default async function DietaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const stage = dietaryStageOf(params.stage);
  const criticalQuery = parseListQuery(params, WRITE_IN_LIST, CRITICAL_WRITE_IN_PREFIX);
  const otherQuery = parseListQuery(params, WRITE_IN_LIST, WRITE_IN_PREFIX);
  const unregisteredQuery = parseListQuery(params, UNREGISTERED_LIST, UNREGISTERED_PREFIX);
  const [counts, criticalWriteIns, otherWriteIns, unregistered] = await Promise.all([
    dietaryCounts(stage),
    listWriteIns(true, stage, criticalQuery),
    listWriteIns(false, stage, otherQuery),
    listUnregistered(unregisteredQuery, stage),
  ]);
  return (
    <DietaryView
      stage={stage}
      counts={counts}
      criticalQuery={criticalQuery}
      criticalWriteIns={criticalWriteIns}
      otherQuery={otherQuery}
      otherWriteIns={otherWriteIns}
      unregisteredQuery={unregisteredQuery}
      unregistered={unregistered}
    />
  );
}
