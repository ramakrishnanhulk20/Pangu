import { Buffer } from "buffer";

// Next hands the browser an old Buffer as a global, and @solana/spl-token's
// transfer hook helpers call writeBigUInt64LE on it without importing their
// own. That method only exists from buffer 6, so the modern package becomes the
// global before any transaction is built. Node already has the real Buffer and
// is left alone.
if (typeof window !== "undefined") {
  const current = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (current === undefined || typeof current.alloc(8).writeBigUInt64LE !== "function") {
    (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
  }
}
