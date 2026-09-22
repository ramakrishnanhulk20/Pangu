// Keeps this package's copy of the Pangu interface in step with the program.
//
//   node scripts/idl.mjs sync    copy the program's generated IDL in here
//   node scripts/idl.mjs check   refuse to build without a usable copy
//
// The program's target/ folder is not committed, so the copy under src/idl is
// what everyone who installs this package actually gets.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "program", "target", "idl", "pangu.json");
const copy = join(here, "..", "src", "idl", "pangu.json");

function read(path) {
  // A byte-order mark in front of the JSON is invisible and breaks strict
  // parsers, so it is stripped here rather than carried into the copy.
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  return JSON.parse(text);
}

function mustBePanguIdl(idl, path) {
  const problems = [];
  if (typeof idl.address !== "string") problems.push("no program address");
  if (idl?.metadata?.name !== "pangu") problems.push("metadata.name is not pangu");
  for (const key of ["instructions", "accounts", "errors", "types"]) {
    if (!Array.isArray(idl[key]) || idl[key].length === 0) {
      problems.push(`no ${key}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`${path} is not a usable Pangu IDL: ${problems.join(", ")}`);
  }
}

function serialise(idl) {
  return `${JSON.stringify(idl, null, 2)}\n`;
}

function sync() {
  if (!existsSync(source)) {
    throw new Error(
      `no generated IDL at ${source}. Build the program first: cd packages/program && anchor build`
    );
  }
  const idl = read(source);
  mustBePanguIdl(idl, source);
  mkdirSync(dirname(copy), { recursive: true });
  writeFileSync(copy, serialise(idl), "utf8");
  console.log(`pangu-sdk: idl copied from ${source}`);
  console.log(`pangu-sdk: program ${idl.address}, ${idl.instructions.length} instructions`);
}

function check() {
  if (!existsSync(copy)) {
    throw new Error(
      `pangu-sdk cannot build: src/idl/pangu.json is missing. Run "npm run sync-idl" with the program built.`
    );
  }
  const idl = read(copy);
  mustBePanguIdl(idl, copy);
  if (existsSync(source) && serialise(read(source)) !== serialise(idl)) {
    console.log(
      `pangu-sdk: warning, the program's IDL has changed. Run "npm run sync-idl".`
    );
  }
}

const mode = process.argv[2];
try {
  if (mode === "sync") {
    sync();
  } else if (mode === "check") {
    check();
  } else {
    throw new Error(`unknown mode "${mode ?? ""}". Use sync or check.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
