// Rebuilds pangu-sdk and puts the new build into this app.
//
//   npm run sdk:refresh
//
// Why this exists. This app installs the SDK as a copied folder rather than a
// symlink, because a symlink lets node resolve @solana/web3.js inside
// packages/sdk as well as here, and two copies of PublicKey are not the same
// class, so every input check fails. See .npmrc. The copy has its own problem:
// npm sees the same `file:../sdk` dependency at the same version and leaves the
// old copy in place, so an SDK rebuild never reaches this app.
//
// A changed dependency list needs more than deleting the copy. npm keeps the
// SDK's own dependency tree in this package's lockfile and will not re-resolve
// it for a file: dependency, so when the two lists differ this throws the
// lockfile and node_modules away and installs from scratch.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const sdk = join(web, "..", "sdk");
const modules = join(web, "node_modules");
const copy = join(modules, "pangu-sdk");

// On Windows npm is a .cmd file, and node refuses to spawn one without a shell.
// Every argument below is a constant written in this file, so there is nothing
// for a shell to expand.
const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";

function run(where, args) {
  execFileSync(npm, args, { cwd: where, stdio: "inherit", shell: windows });
}

function dependenciesOf(packageDirectory) {
  const file = join(packageDirectory, "package.json");
  if (!existsSync(file)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return JSON.stringify(parsed.dependencies ?? {});
}

run(sdk, ["run", "build"]);

const sameDependencies = dependenciesOf(copy) === dependenciesOf(sdk);
if (sameDependencies) {
  rmSync(copy, { recursive: true, force: true });
} else {
  console.log(
    "pangu-sdk's own dependencies changed, so this is a clean install of packages/web"
  );
  rmSync(modules, { recursive: true, force: true });
  rmSync(join(web, "package-lock.json"), { force: true });
}
run(web, ["install", "--no-audit", "--no-fund"]);

console.log("pangu-sdk rebuilt and reinstalled into packages/web");
