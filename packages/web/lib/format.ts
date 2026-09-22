import { ACCESS_MODE } from "pangu-sdk";

/** Raw token units to a readable number, without floating point rounding. */
export function tokenAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;

  const grouped = whole.toLocaleString("en-US");
  if (fraction === 0n) {
    return `${negative ? "-" : ""}${grouped}`;
  }

  const trimmed = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, 2)
    .replace(/0+$/, "");
  return trimmed === ""
    ? `${negative ? "-" : ""}${grouped}`
    : `${negative ? "-" : ""}${grouped}.${trimmed}`;
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
