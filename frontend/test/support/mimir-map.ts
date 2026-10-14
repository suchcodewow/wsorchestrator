/** A small made-up concept map, for the tests. Nothing in it is real course content. */

import { mapContentSchema, type MapContent } from "@/lib/mimir/map/schema";

export function mapFixture(overrides: Partial<Record<string, unknown>> = {}): MapContent {
  return mapContentSchema.parse({
    version: 1,
    title: "Test map",
    sections: [
      { from: 1, to: 3, name: "First half", band: 1 },
      { from: 4, to: 6, name: "Second half", band: 2 },
    ],
    slides: [1, 2, 3, 4, 5, 6].map((n) => ({ n, title: `Slide ${n}` })),
    levels: [
      { level: 1, name: "Level 100: Basics", blurb: "The basics." },
      { level: 2, name: "Level 200: More", blurb: "More." },
    ],
    buckets: [
      { id: "g1", level: 1, name: "Group one", blurb: "One.", concepts: ["alpha", "beta"] },
      { id: "g2", level: 1, name: "Group two", blurb: "Two.", concepts: ["gamma"] },
      { id: "g3", level: 2, name: "Group three", blurb: "Three.", concepts: ["delta", "omega"] },
    ],
    concepts: [
      {
        id: "alpha",
        name: "Alpha",
        slides: [1, 2],
        explanation: "Alpha comes first.",
        video: { object: "mimir/videos/test-alpha.mp4", seconds: 100, transcript: "The narrator explains alpha with a bakery." },
      },
      { id: "beta", name: "Beta", slides: [2, 3], explanation: "Beta comes second." },
      {
        id: "gamma",
        name: "Gamma",
        slides: [3],
        explanation: "Gamma comes third.",
        video: { object: "mimir/videos/test-gamma.mp4", seconds: 60, transcript: "The narrator explains gamma." },
      },
      { id: "delta", name: "Delta", slides: [3, 4, 5], explanation: "Delta is level two." },
      { id: "omega", name: "Omega", slides: [6], explanation: "Omega is last." },
    ],
    ...overrides,
  });
}
