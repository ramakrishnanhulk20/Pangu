/** The words the readout puts numbers in. Nothing here decides a number, only how it reads. */

export type Money = "dollars" | "SOL";

/**
 * An amount of the token buyers pay in.
 *
 * A dollar sale is quoted the way a price is quoted. The demo's other sale is
 * paid for in SOL, where a share costs a tiny fraction of one, so that side
 * keeps significant digits instead of two decimal places and never rounds a
 * real price down to zero.
 */
export function money(value: number, unit: Money): string {
  if (unit === "SOL") {
    if (value === 0) {
      return "0 SOL";
    }
    const digits =
      value >= 0.0001
        ? { maximumFractionDigits: 4 }
        : { maximumSignificantDigits: 2, maximumFractionDigits: 20 };
    return `${value.toLocaleString("en-US", digits)} SOL`;
  }

  if (value >= 1_000_000) {
    return `$${value.toLocaleString("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    })}`;
  }

  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A count of shares, short enough to sit under a number twice its size. */
export function shares(value: number): string {
  if (value >= 100_000) {
    return value.toLocaleString("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    });
  }
  return Math.round(value).toLocaleString("en-US");
}

export function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

export function whole(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
