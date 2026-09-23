import { Buffer as Modern } from "buffer";

// In the browser the bundler injects its own old Buffer wherever code writes
// the bare name, and @solana/spl-token's transfer hook helpers build their
// instruction data with it. That copy predates writeBigUInt64LE, so every
// ledger row failed before it reached the chain. The bare name below is the
// same injected class those helpers get, so the missing 64-bit methods are
// copied onto its prototype from the modern package, and the global is pointed
// at the modern one for code that goes through globalThis. Node has the real
// Buffer and is left alone.
if (typeof window !== "undefined") {
  const methods = [
    "readBigUInt64LE",
    "readBigUInt64BE",
    "readBigInt64LE",
    "readBigInt64BE",
    "writeBigUInt64LE",
    "writeBigUInt64BE",
    "writeBigInt64LE",
    "writeBigInt64BE",
  ] as const;

  const patch = (target: { prototype: object } | undefined) => {
    if (!target || target === Modern) return;
    const proto = target.prototype as Record<string, unknown>;
    const source = Modern.prototype as unknown as Record<string, unknown>;
    for (const name of methods) {
      if (typeof proto[name] !== "function" && typeof source[name] === "function") {
        proto[name] = source[name];
      }
    }
  };

  // The bare name: whatever the bundler injects here is what the libraries see.
  patch(typeof Buffer !== "undefined" ? Buffer : undefined);
  const globalScope = globalThis as { Buffer?: typeof Modern };
  patch(globalScope.Buffer);
  globalScope.Buffer = Modern;
}
