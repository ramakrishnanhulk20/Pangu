import { ACCESS_MODE } from "pangu-sdk";

/**
 * Raw token units to a readable number, without floating point rounding.
 *
 * Below one it keeps up to four decimals, and an amount too small even for
 * that reads "under 0.0001", never "0": a wallet holding a sliver of a share
 * holds something. Up to 1,000 it keeps two decimals. Above 1,000 it rounds to
 * the whole unit, the only place rounding is allowed to hide a fraction.
 */
export function tokenAmount(raw: bigint, decimals: number): string {
  const sign = raw < 0n ? "-" : "";
  const value = raw < 0n ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;

  if (whole > 1000n || (whole === 1000n && fraction > 0n)) {
    const rounded = fraction * 2n >= scale ? whole + 1n : whole;
    return `${sign}${rounded.toLocaleString("en-US")}`;
  }

  const grouped = whole.toLocaleString("en-US");
  if (fraction === 0n) {
    return `${sign}${grouped}`;
  }

  const places = whole === 0n ? 4 : 2;
  const trimmed = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, places)
    .replace(/0+$/, "");
  if (trimmed === "") {
    if (whole > 0n) {
      return `${sign}${grouped}`;
    }
    return sign === "" ? "under 0.0001" : "just below 0";
  }
  return `${sign}${grouped}.${trimmed}`;
}

export function accessModeLabel(mode: number): string {
  switch (mode) {
    case ACCESS_MODE.open:
      return "Open to anyone";
    case ACCESS_MODE.issuerList:
      return "Issuer list";
    case ACCESS_MODE.verifierCredential:
      return "Verified credential";
    default:
      return `Mode ${mode}`;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
