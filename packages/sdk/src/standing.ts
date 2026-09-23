import type { PublicKey } from "@solana/web3.js";
import type { BuyerRecord, Sale } from "./accounts.js";
import { PanguInputError } from "./inputs.js";

/** How concentrated a sale is right now, from the records themselves. */
export interface SaleStanding {
  /** Wallets holding more than zero net of what they sold back. */
  buyers: number;
  /** Everything the pool has sold, net of sells, in raw token units. */
  totalNetBought: bigint;
  /** The wallet holding the most, or null when nothing has been sold. */
  largestWallet: PublicKey | null;
  largestNetBought: bigint;
  /** The largest wallet's share of everything sold, 0 to 1. */
  largestShare: number;
  /** What one wallet's cap is worth as a share of everything sold, 0 to 1 and above. */
  capShare: number;
  /**
   * True once the sale's offering period has ended: from then on the hook
   * counts nothing and the token moves freely. Always false for a sale with no
   * end, which includes every version 1 sale.
   */
  offeringOver: boolean;
}

/** Nine decimal places is far past what any share bar in the app can show. */
const SHARE_SCALE = 1_000_000_000n;

function share(part: bigint, whole: bigint): number {
  if (whole <= 0n) {
    return 0;
  }
  return Number((part * SHARE_SCALE) / whole) / Number(SHARE_SCALE);
}

/**
 * Works out how concentrated a sale is from its records.
 *
 * The counts come from the records, not from the rules account's own running
 * totals, so what the app shows is the sum of the accounts a judge can open.
 * Records belonging to another sale are refused rather than ignored: silently
 * dropping them would understate the largest holder.
 *
 * `now` is the Unix second to judge the offering period against. Pass the
 * chain's clock when you have it, because that is the clock the hook reads and
 * a browser's can be minutes out; without it this machine's clock stands in,
 * which can only misjudge the end within that drift.
 */
export function saleStanding(
  sale: Sale,
  records: BuyerRecord[],
  now: number = Math.floor(Date.now() / 1000)
): SaleStanding {
  if (!Array.isArray(records)) {
    throw new PanguInputError("records must be an array of buyer records");
  }

  let total = 0n;
  let buyers = 0;
  let largestWallet: PublicKey | null = null;
  let largestNetBought = 0n;

  for (const record of records) {
    if (!record.mint.equals(sale.mint)) {
      throw new PanguInputError(
        `a record for ${record.mint.toBase58()} was passed with the sale of ${sale.mint.toBase58()}`
      );
    }
    total += record.netBought;
    if (record.netBought > 0n) {
      buyers += 1;
    }
    if (record.netBought > largestNetBought) {
      largestNetBought = record.netBought;
      largestWallet = record.wallet;
    }
  }

  return {
    buyers,
    totalNetBought: total,
    largestWallet,
    largestNetBought,
    largestShare: share(largestNetBought, total),
    capShare: share(sale.cap, total),
    offeringOver: sale.endsAt !== null && now >= sale.endsAt,
  };
}
