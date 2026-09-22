import type { OpenedSale } from "./sales";

/** What one sale's buyer records add up to. */
export interface Standing {
  buyers: number;
  largestShare: number;
  capShare: number;
}

/** The sharing numbers together with the sale they were read from. */
export interface Sharing {
  name: string;
  standing: Standing;
}

export interface SharingResult {
  sharing: Sharing | null;
  /** How many sales were tried and could not be read. */
  skipped: number;
}

/**
 * Walks the sales in the order given and stops at the first one that reads.
 *
 * A sale account written by another build of the program throws a
 * `PanguLayoutError` when this package decodes it, and a sale that has gone
 * away reads as null. Either way the cost is that one sale: the walk carries on
 * to the next, and the count of the ones it passed over goes out with the
 * numbers so the page can say how many it left out.
 *
 * The reader is passed in so this walk can be exercised without a chain.
 */
export async function firstReadableSharing(
  order: OpenedSale[],
  standingOf: (mint: string) => Promise<Standing | null>
): Promise<SharingResult> {
  let skipped = 0;

  for (const opened of order) {
    try {
      const standing = await standingOf(opened.mint);
      if (standing !== null) {
        return { sharing: { name: opened.name, standing }, skipped };
      }
    } catch {
      // Nothing is invented in place of a sale that will not read.
    }
    skipped += 1;
  }

  return { sharing: null, skipped };
}
