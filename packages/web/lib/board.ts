import { getTransferHook, unpackMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  PANGU_PROGRAM_ID,
  PanguLayoutError,
  TOKEN_2022_PROGRAM_ID,
  decodeSale,
  saleRulesAddress,
  type Sale,
} from "pangu-sdk";

import { accessModeLabel, tokenAmount } from "./format";
import { openedSales } from "./sales";
import { devnetConnection } from "./solana";
import type { SaleRow } from "@/components/sale-rows";

/**
 * The whole board in two RPC calls: every rules account in one, every mint in
 * the other.
 *
 * The SDK's own getSale and isSaleRunning are one account each, which is right
 * for a single sale and wrong for a list. Six sales that way is eighteen calls
 * and the public devnet endpoint answers 429 to the tail of them, which turned
 * a 0.2 second page into an 8 second one. The decoding below is the SDK's, only
 * the fetching is batched.
 */
export async function readBoard(): Promise<SaleRow[]> {
  const opened = openedSales();
  const mints = opened.map((sale) => new PublicKey(sale.mint));
  const rules = mints.map(saleRulesAddress);
  const connection = devnetConnection();

  const [ruleAccounts, mintAccounts] = await Promise.all([
    connection.getMultipleAccountsInfo(rules),
    connection.getMultipleAccountsInfo(mints),
  ]);

  return opened.map((opening, index) => {
    const ruleAccount = ruleAccounts[index];
    const mintAccount = mintAccounts[index];
    const base: SaleRow = {
      mint: opening.mint,
      name: opening.name,
      symbol: opening.symbol,
      status: "",
      access: "",
      cap: "",
      buyers: "",
      sold: "",
      band: "",
    };

    if (ruleAccount === null || !ruleAccount.owner.equals(PANGU_PROGRAM_ID)) {
      return { ...base, status: "no Pangu rules at this mint" };
    }

    // A sale opened by an older build of the program sits at the same address
    // behind the same discriminator, so the SDK refuses it rather than hand
    // back fields read at the wrong offsets. That is one quiet row, not a
    // broken board. Anything else is a real fault and still surfaces.
    let sale: Sale;
    try {
      sale = decodeSale(ruleAccount.data);
    } catch (error) {
      if (error instanceof PanguLayoutError) {
        return {
          ...base,
          status: "opened by an earlier build, not readable by this one",
        };
      }
      throw error;
    }

    // A sale without a price band never stored its decimals, so they come off
    // the mint, the same place getSale takes them from.
    let decimals = sale.baseDecimals;
    let running = false;
    if (mintAccount !== null && mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      const state = unpackMint(mints[index], mintAccount, TOKEN_2022_PROGRAM_ID);
      if (decimals === 0) {
        decimals = state.decimals;
      }
      const hook = getTransferHook(state);
      running = hook !== null && hook.programId.equals(PANGU_PROGRAM_ID);
    }

    return {
      ...base,
      status: running ? "Running" : "Graduated",
      access: accessModeLabel(sale.accessMode),
      cap: `${tokenAmount(sale.cap, decimals)} ${opening.symbol}`,
      buyers: sale.buyers.toString(),
      sold: `${tokenAmount(sale.totalNetBought, decimals)} ${opening.symbol}`,
      band: sale.hasBand
        ? `${(sale.bandBps / 100).toFixed(2)}% over the stock price`
        : "No price band",
    };
  });
}
