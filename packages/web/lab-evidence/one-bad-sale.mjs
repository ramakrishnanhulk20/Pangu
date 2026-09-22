import { firstReadableSharing } from "../lib/sharing.ts";

// The same shape the SDK throws when a sale account was written by another
// build of the program: the bytes decode into the wrong fields, so the reader
// refuses them instead of handing back a nonsense cap.
class LayoutError extends Error {
  constructor() {
    super("these are layout version 0 and this package reads version 1");
    this.name = "PanguLayoutError";
  }
}

const listed = [
  { name: "Pangu Listed Share (old build)", mint: "BadMint111" },
  { name: "Pangu Listed Share", mint: "GoodMint222" },
  { name: "Pangu Listed Share (gone)", mint: "MissingMint333" },
];

const reader = async (mint) => {
  if (mint === "BadMint111") {
    throw new LayoutError();
  }
  if (mint === "MissingMint333") {
    return null;
  }
  return { buyers: 7, largestShare: 0.18, capShare: 0.25 };
};

const mixed = await firstReadableSharing(listed, reader);
const allBad = await firstReadableSharing(
  [listed[0], listed[2]],
  reader
);

console.log("mixed list   ", JSON.stringify(mixed));
console.log("nothing reads", JSON.stringify(allBad));

const survived =
  mixed.sharing !== null &&
  mixed.sharing.name === "Pangu Listed Share" &&
  mixed.sharing.standing.buyers === 7 &&
  mixed.skipped === 1;

const quiet = allBad.sharing === null && allBad.skipped === 2;

console.log(
  survived
    ? "the good sale survived the bad one, and the bad one is counted as skipped"
    : "FAILED: the good sale did not survive"
);
console.log(
  quiet
    ? "with nothing readable the walk returns no numbers, so the hero says the list is refreshing"
    : "FAILED: the empty case did not come back clean"
);

if (!survived || !quiet) {
  process.exit(1);
}
