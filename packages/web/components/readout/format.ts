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

  // Two decimal places would print a real amount under a cent as $0.00.
  if (value > 0 && value < 0.01) {
    return "under $0.01";
  }

  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A count of shares, short enough to sit under a number twice its size.
 *
 * Below one it keeps up to four decimals and never reads "0" for a real
 * amount. Rounding to whole shares starts only above 1,000, where a fraction
 * no longer changes what the number says.
 */
export function shares(value: number): string {
  if (value >= 100_000) {
    return value.toLocaleString("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    });
  }
  if (value > 1_000) {
    return Math.round(value).toLocaleString("en-US");
  }
  if (value > 0 && value < 0.0001) {
    return "under 0.0001";
  }
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value < 1 ? 4 : 2,
    roundingMode: "trunc",
  });
}

/** A share of something as a percentage, shown as it is: past 100 is past 100. */
export function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

export function whole(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A moment as hours and minutes, with the day in front when it is not the day
 * of the reading it is compared against.
 *
 * Always in UTC and always labelled so: the server renders this line before
 * the visitor's own clock is known, and a time in the server's zone with no
 * label would be wrong for most people reading it.
 */
export function clock(at: number, against: number = at): string {
  const moment = new Date(at);
  const hours = String(moment.getUTCHours()).padStart(2, "0");
  const minutes = String(moment.getUTCMinutes()).padStart(2, "0");
  const time = `${hours}:${minutes} UTC`;
  const day = (value: Date) => value.toISOString().slice(0, 10);
  return day(new Date(against)) === day(moment)
    ? time
    : `${moment.getUTCDate()} ${MONTHS[moment.getUTCMonth()]} ${time}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
