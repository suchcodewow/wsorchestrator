/**
 * What the Map Editor says an edit changed, and the map's structure without
 * its videos and back again, as the versions and the video rows keep them.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { describeChanges } from "@/lib/mimir/map/edit";
import { videoRows, withoutVideos, withVideos } from "@/lib/mimir/map/schema";
import { mapFixture } from "../support/mimir-map";

describe("describeChanges", () => {
  test("nothing changed, nothing said", () => {
    assert.deepEqual(describeChanges(mapFixture(), mapFixture()), []);
  });

  test("a renamed section, a dependency added and one taken away, and a concept moved", () => {
    const before = mapFixture();
    const after = structuredClone(before);
    after.sections[0]!.name = "Software Delivery Agent";
    after.concepts.find((c) => c.id === "delta")!.requires = ["alpha", "beta"];
    after.buckets[0]!.concepts = ["alpha"];
    after.buckets[1]!.concepts = ["gamma", "beta"];
    assert.deepEqual(describeChanges(before, after), [
      `Renamed the section “${before.sections[0]!.name}” to “Software Delivery Agent”.`,
      "Moved “Beta” to the group “Group two”.",
      "“Delta” now depends on “Beta”.",
      "“Delta” no longer depends on “Gamma”.",
    ]);
  });
});

describe("a map's videos apart from its structure", () => {
  test("taken out and put back, the map is as it was", () => {
    const map = mapFixture();
    const structure = withoutVideos(map);
    assert.equal(
      structure.concepts.some((c) => c.video),
      false,
    );
    assert.deepEqual(withVideos(structure, videoRows(map)), map);
  });

  test("a translation without its English is not put back", () => {
    const structure = withoutVideos(mapFixture());
    const back = withVideos(structure, [
      { conceptId: "alpha", language: "es", object: "mimir/videos/a.es.mp4", seconds: 1, transcript: "es" },
    ]) as typeof structure;
    assert.equal(back.concepts.find((c) => c.id === "alpha")!.video, undefined);
  });
});
