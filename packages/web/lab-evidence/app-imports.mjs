/**
 * Lets a lab-evidence script import the app's own TypeScript files under plain
 * Node.
 *
 *   const { money } = await importApp("components/readout/format.ts");
 *
 * The app's files follow the bundler's rules: "@/" for the package root,
 * relative imports with no file extension, and JSON imported with no type
 * attribute. Node is taught those three here. The hooks are registered on the
 * first call, which is why the app's files are imported through this function
 * and not with a static import: every static import is resolved before any
 * code in the script runs.
 */

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const web = new URL("../", import.meta.url);

let registered = false;

function register() {
  if (registered) {
    return;
  }
  registered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parentUrl = context.parentURL ?? "";
      const wanted = specifier.startsWith("@/") ? new URL(specifier.slice(2), web).href : specifier;
      const local =
        (wanted.startsWith(".") || wanted.startsWith("file:")) &&
        !parentUrl.includes("node_modules") &&
        !/\.([cm]?[jt]sx?|json)$/.test(wanted);
      if (!local) {
        return nextResolve(wanted, context);
      }
      try {
        return nextResolve(`${wanted}.ts`, context);
      } catch {
        return nextResolve(`${wanted}.tsx`, context);
      }
    },
    load(url, context, nextLoad) {
      if (url.endsWith(".json") && !url.includes("node_modules") && context.importAttributes?.type !== "json") {
        const text = readFileSync(fileURLToPath(url), "utf8");
        return { format: "module", source: `export default ${text};`, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}

/** Imports a file of the web package by its path from the package root. */
export function importApp(path) {
  register();
  return import(new URL(path, web).href);
}
