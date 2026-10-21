import { randomBytes, randomInt } from "node:crypto";

const WORDS = [
  "amber", "anchor", "aspen", "atlas", "basil", "beacon", "birch", "bramble", "cedar", "cinder", "clover", "comet",
  "coral", "cove", "dune", "ember", "fable", "fern", "flint", "harbor", "hazel", "heron", "indigo", "juniper",
  "kestrel", "lantern", "linen", "maple", "meadow", "mica", "moss", "nectar", "nimbus", "oak", "onyx", "orchid",
  "pebble", "pine", "plume", "quartz", "quill", "raven", "reed", "ripple", "saffron", "sage", "sparrow", "spruce",
  "summit", "thistle", "tide", "topaz", "umber", "vale", "violet", "willow", "wren", "zephyr",
];

/** Readable passcode, e.g. "quill-harbor-ember-4821" (~32 bits + rate-limited login). */
export function makePasscode(): string {
  const w = () => WORDS[randomInt(WORDS.length)];
  return `${w()}-${w()}-${w()}-${randomInt(1000, 10000)}`;
}

export const makeSecret = (bytes = 32) => randomBytes(bytes).toString("base64url");
