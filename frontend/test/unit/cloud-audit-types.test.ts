/**
 * How the Cloud Status page orders and counts what an audit found.
 *
 * The page exists to find money being spent on things no run claims, so
 * `untracked` — ours, but no run owns it — sorts first and its count drives
 * the page's headline. Within a classification the order is by id, so two
 * loads of the same cloud read the same way.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CLOUDS } from "@/db/schema";
import {
  AUDIT_TARGETS,
  CLASSIFICATIONS,
  summarize,
  type AuditedResource,
  type Classification,
} from "@/lib/cloud-audit/types";

const r = (id: string, classification: Classification): AuditedResource => ({
  id,
  name: null,
  url: null,
  state: null,
  classification,
  owner: null,
});

describe("constants", () => {
  test("every cloud is an audit target, plus Harness", () => {
    assert.deepEqual(AUDIT_TARGETS, [...CLOUDS, "harness"]);
  });

  test("classifications are listed most-urgent first", () => {
    assert.deepEqual(CLASSIFICATIONS, ["untracked", "infra", "tracked", "unmanaged"]);
  });
});

describe("summarize", () => {
  test("sorts by classification, then by id", () => {
    const { resources } = summarize([
      r("b", "tracked"),
      r("z", "unmanaged"),
      r("a", "tracked"),
      r("m", "untracked"),
      r("c", "infra"),
      r("a", "untracked"),
    ]);
    assert.deepEqual(
      resources.map((x) => `${x.classification}:${x.id}`),
      ["untracked:a", "untracked:m", "infra:c", "tracked:a", "tracked:b", "unmanaged:z"],
    );
  });

  test("counts each classification and the total", () => {
    const { counts } = summarize([r("a", "untracked"), r("b", "untracked"), r("c", "tracked")]);
    assert.deepEqual(counts, { total: 3, untracked: 2, infra: 0, tracked: 1, unmanaged: 0 });
  });

  test("an empty audit is all zeros", () => {
    assert.deepEqual(summarize([]), {
      resources: [],
      counts: { total: 0, untracked: 0, infra: 0, tracked: 0, unmanaged: 0 },
    });
  });

  test("does not reorder the caller's array", () => {
    const input = [r("b", "tracked"), r("a", "untracked")];
    summarize(input);
    assert.deepEqual(input.map((x) => x.id), ["b", "a"]);
  });

  test("counts always add up to the total", () => {
    const input = CLASSIFICATIONS.flatMap((c, i) => Array.from({ length: i + 1 }, (_, n) => r(`${c}${n}`, c)));
    const { counts } = summarize(input);
    assert.equal(counts.untracked + counts.infra + counts.tracked + counts.unmanaged, counts.total);
    assert.equal(counts.total, input.length);
  });
});
