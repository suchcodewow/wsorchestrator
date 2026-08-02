import crypto from "node:crypto";

/**
 * Word lists for attendee account names: an attendee gets `bouncypenguin`
 * rather than `workshop-07`, which is friendlier to read out in a room and
 * easier to type than a slug plus digits.
 *
 * Both lists are lowercase a-z only — the words go straight into an email
 * local part, so anything else would need escaping. Keep them cheerful and
 * about the *thing*, never about the person: an attendee is handed this name
 * in front of a room, so nothing that could read as a jab at them.
 */
export const ADJECTIVES = [
  "adorable", "agile", "ample", "artful", "bashful", "blissful", "bold",
  "bouncy", "brave", "breezy", "brisk", "bubbly", "cheeky", "chipper",
  "chirpy", "chunky", "clever", "cosmic", "cozy", "crafty", "crispy",
  "curious", "dainty", "dandy", "dapper", "daring", "dizzy", "dreamy",
  "eager", "fancy", "feisty", "frisky", "fuzzy", "gentle", "giddy",
  "glossy", "groovy", "hasty", "humble", "jaunty", "jazzy", "jolly",
  "kooky", "lanky", "lively", "loopy", "lucky", "mellow", "merry",
  "nifty", "nimble", "noble", "peppery", "peppy", "perky", "playful",
  "plucky", "plush", "polite", "prickly", "proud", "quiet", "quirky",
  "rapid", "rowdy", "rusty", "sassy", "scruffy", "sharp", "shiny",
  "silky", "silly", "sleepy", "smooth", "snappy", "snazzy", "sneaky",
  "soggy", "sparkly", "speedy", "spicy", "spiffy", "spunky", "squeaky",
  "stellar", "sticky", "stormy", "sturdy", "sublime", "sunny", "swanky",
  "swift", "tangy", "tender", "thrifty", "tidy", "toasty", "tricky",
  "twirly", "valiant", "velvety", "vivid", "wacky", "whimsical", "wiggly",
  "windy", "wise", "witty", "zany", "zealous", "zesty", "zippy",
] as const;

export const NOUNS = [
  "accordion", "acorn", "albatross", "alpaca", "anchor", "armadillo",
  "asteroid", "axolotl", "badger", "bagel", "banjo", "beaver", "biscuit",
  "bison", "bongo", "capybara", "caracal", "caribou", "chameleon",
  "chinchilla", "comet", "compass", "coyote", "crane", "crumpet",
  "dingo", "dumpling", "egret", "elk", "emu", "falcon", "ferret",
  "finch", "flamingo", "gannet", "gecko", "gherkin", "harmonica",
  "hedgehog", "heron", "ibex", "ibis", "iguana", "jackal", "kazoo",
  "kestrel", "kettle", "kiwi", "koala", "kumquat", "lantern", "lemur",
  "llama", "lychee", "lynx", "magpie", "manatee", "mango", "marmoset",
  "marmot", "marten", "meerkat", "meteor", "mongoose", "moose", "muffin",
  "muskrat", "narwhal", "nebula", "newt", "noodle", "oboe", "ocelot",
  "okapi", "ostrich", "osprey", "otter", "pancake", "pangolin", "panda",
  "papaya", "parsnip", "pebble", "pelican", "penguin", "pickle",
  "platypus", "porcupine", "possum", "pretzel", "puffin", "pulsar",
  "quasar", "quokka", "raccoon", "radish", "raven", "rocket",
  "salamander", "serval", "sparrow", "stoat", "stork", "tambourine",
  "tapir", "teapot", "terrapin", "tortoise", "toucan", "tuba", "turnip",
  "ukulele", "walrus", "waffle", "weasel", "wolverine", "wombat", "wren",
  "xylophone", "yak",
] as const;

/** Distinct `adjective-noun` combinations available before suffixes. */
export const COMBINATIONS = ADJECTIVES.length * NOUNS.length;

function pick<T>(list: readonly T[]): T {
  // randomInt is uniform; `Math.random() * length` is not, and a biased
  // generator would collide far more often than the namespace size suggests.
  return list[crypto.randomInt(list.length)];
}

/** A username like `bouncypenguin`. */
export function randomUsername(): string {
  return `${pick(ADJECTIVES)}${pick(NOUNS)}`;
}

/**
 * Split a generated local part back into display names: `bouncypenguin` ->
 * `Bouncypenguin` (family `Attendee`), `bouncypenguin-42` -> `Bouncypenguin`
 * / `42`. Still handles the older hyphenated `bouncy-penguin` form so display
 * names for accounts created before the hyphen was dropped keep working. Used
 * for the account's given/family name in Workspace.
 */
export function displayName(localPart: string): {
  givenName: string;
  familyName: string;
} {
  const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const [first, ...rest] = localPart.split("-");
  return {
    givenName: capitalize(first ?? "Workshop"),
    familyName: rest.length > 0 ? rest.map(capitalize).join(" ") : "Attendee",
  };
}
