/**
 * Takes a sale out of the devnet demo without deleting its entry.
 *
 *   npm run retire -- --mint <mint>
 *
 * The entry in sales.json gains a `retiredAt` time. After that no command
 * picks the sale on its own, `--mint` refuses it, and `status` stops checking
 * it. The entry stays, because it is the record that the sale was opened and
 * its addresses stay public on chain. Nothing is read from or sent to devnet.
 */

import { readFlags, requiredText } from "./arguments.js";
import { SALES_FILE, retireSale } from "./sales.js";

function main(): void {
  const flags = readFlags(process.argv.slice(2), ["mint"]);
  const mint = requiredText(flags, "mint", "it names the sale to retire");
  const now = new Date();
  const retiredAt = retireSale(mint, now);
  console.log(
    retiredAt === now.toISOString()
      ? `retired  : ${mint} at ${retiredAt}, in ${SALES_FILE}`
      : `retired  : ${mint} was already retired at ${retiredAt}, nothing changed`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
