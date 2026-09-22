/**
 * Everything a Pangu sale does on Meteora's Dynamic Bonding Curve: open the
 * launch template, open the sale, trade in it, claim the fees, graduate it.
 *
 * This entry point pulls in `@meteora-ag/dynamic-bonding-curve-sdk`. The core
 * entry point does not, so a page that only reads a sale stays small.
 */

export { launchTemplateTransaction, panguCurve, FORCED } from "./template.js";
export type { LaunchTemplateInput, LaunchTemplate } from "./template.js";

export { openSaleTransaction, capFromShare } from "./open.js";
export type { OpenSaleInput, OpenSale, SaleTerms } from "./open.js";

export { buyTransaction, sellTransaction } from "./trade.js";
export type { BuyInput, SellInput, TradeTransaction } from "./trade.js";

export { preflightBuy } from "./preflight.js";
export type { PreflightBuyInput, BuyPreflight } from "./preflight.js";

export { claimFeesTransaction } from "./fees.js";
export type { ClaimFeesInput, ClaimFees } from "./fees.js";

export { graduateTransaction, saleProgress } from "./graduate.js";
export type { GraduateInput, Graduate, SaleProgress } from "./graduate.js";

export { hookAccounts, hookAccountsInfo } from "./hook.js";
export type { HookAccountsInput, PendingTokenAccount } from "./hook.js";

export { loadPool, requireSale, dbcProgram, DBC_POOL_AUTHORITY } from "./state.js";
export type { PoolView } from "./state.js";

export {
  COMPUTE_LIMIT,
  TRANSACTION_SIZE_LIMIT,
  transactionBytes,
  requireOneTransaction,
} from "./budget.js";
