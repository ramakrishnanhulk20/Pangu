import type { Connection, PublicKey, SendOptions, Transaction, VersionedTransaction } from "@solana/web3.js";

import { IRYS, browserRpcUrl } from "./network";

/**
 * A sale token's face: its logo, a paragraph about it and its links, written as
 * the Metaplex token metadata JSON that wallets and explorers read, and stored
 * through Irys, paid by the issuer's own wallet.
 *
 * Browser safe. The Irys packages are loaded only when an upload starts, so
 * pages that just read a token's metadata never download them.
 */

/**
 * Where the files go, per network in lib/network. Irys's devnet node is paid in
 * devnet SOL and keeps what it is given for about 60 days; its mainnet node
 * stores the files on Arweave permanently.
 */
export const STORAGE = { node: IRYS.node, gateway: IRYS.gateway, kept: IRYS.kept } as const;

export const STORAGE_WORDS = IRYS.words;

export const LOGO_TYPES: Readonly<Record<string, string>> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WEBP",
  "image/svg+xml": "SVG",
};

export const MAX_LOGO_BYTES = 1024 * 1024;
export const LOGO_EDGE = 512;
export const MAX_DESCRIPTION = 400;
const MAX_LINK = 200;

/** Past this a picture is not worth decoding just to shrink it. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * A signed Irys data item carries its signature, owner, anchor and tags ahead
 * of the data, a few hundred bytes for a Solana signer. Pricing each file this
 * much larger than its data keeps the funded amount from falling short.
 */
const ITEM_HEADER_BYTES = 1024;

/** Metadata JSON this large is not a token's description. */
const MAX_METADATA_BYTES = 64 * 1024;
const READ_TIMEOUT_MS = 8_000;

/**
 * The most this page lets a wallet pay Irys for one launch's files, 0.02 SOL.
 * A logo and a short JSON cost a small fraction of that. The price comes from
 * whatever the node's /price answers, so a node that answered wrong, or one
 * that was not Irys, would otherwise set how much the wallet sends.
 */
export const MAX_STORAGE_LAMPORTS = 20_000_000;

/** A storage price over MAX_STORAGE_LAMPORTS, refused before the wallet is asked to pay. */
export class StorageTooDear extends Error {
  constructor(lamports: number) {
    super(
      `Irys asked ${(lamports / 1e9).toFixed(6)} SOL to store these files, more than the ${
        MAX_STORAGE_LAMPORTS / 1e9
      } SOL this page will pay, so nothing was paid. Use a smaller logo, or try again later.`
    );
    this.name = "StorageTooDear";
  }
}

/** How long a funding transfer may take to show up in the Irys balance. */
const CREDIT_WAIT_MS = 120_000;
const CREDIT_POLL_MS = 2_500;

/** A logo ready to upload: checked, and shrunk to 512 px on its long side when it was a larger picture. */
export interface Logo {
  file: File;
  type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** The long side before shrinking, when it was shrunk. */
  shrunkFrom: number | null;
}

export class LogoRefused extends Error {
  constructor(sentence: string) {
    super(sentence);
    this.name = "LogoRefused";
  }
}

export interface MetadataLinks {
  website?: string | null;
  x?: string | null;
}

export interface MetadataInput {
  name: string;
  symbol: string;
  description: string;
  /** Optional: without one the JSON carries the words and links alone, and wallets show a blank icon. */
  image: File | null;
  links: MetadataLinks;
}

/** What a token's metadata JSON says, once read and checked. */
export interface TokenMetadata {
  uri: string;
  name: string;
  symbol: string;
  description: string | null;
  /** Null when the issuer launched without a logo. */
  image: string | null;
  website: string | null;
  x: string | null;
}

/** The wallet as Irys needs it: a key, message signing for each file, and one transfer to fund the node. */
export interface MetadataWallet {
  publicKey: PublicKey;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  sendTransaction: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendOptions
  ) => Promise<string>;
}

/** An upload that landed, all plain values, so a launch that stops later can keep it and use it again. */
export interface StoredMetadata {
  uri: string;
  /** Empty, as are the type and hash, when the launch stored no logo. */
  imageUri: string;
  imageType: string;
  imageSha: string;
  /** Everything the JSON says besides the image, so a changed word means a new JSON. */
  textKey: string;
  /** Lamports Irys priced both files at. */
  priceLamports: number;
  /** The transfer that topped up this wallet's Irys balance, when one was needed. */
  fundSignature: string | null;
  fundLamports: number;
}

export type UploadStage =
  | { stage: "pricing" }
  | { stage: "priced"; lamports: number; shortfall: number }
  | { stage: "funding"; lamports: number }
  | { stage: "crediting"; signature: string }
  | { stage: "uploading"; file: "logo" | "description" }
  | { stage: "logo-stored"; imageUri: string; imageType: string; imageSha: string }
  | { stage: "stored"; uri: string };

export interface UploadOptions {
  /** An earlier upload from this launch. Its logo is used again when the bytes match, and its JSON when every word does too. */
  previous?: StoredMetadata | null;
  /** A funding transfer the node never heard about, from a press that stopped. It is handed to the node again first. */
  unsentFund?: string | null;
  onStage?: (stage: UploadStage) => void;
}

/** The logo's type: the browser's word for it, or the file's ending when the browser gave none. */
function logoType(file: File): string | null {
  if (file.type in LOGO_TYPES) {
    return file.type;
  }
  if (file.type !== "") {
    return null;
  }
  const ending = file.name.toLowerCase().split(".").pop();
  return ending === "png"
    ? "image/png"
    : ending === "jpg" || ending === "jpeg"
      ? "image/jpeg"
      : ending === "webp"
        ? "image/webp"
        : ending === "svg"
          ? "image/svg+xml"
          : null;
}

function sizeWords(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

async function svgSize(file: File): Promise<{ width: number | null; height: number | null }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth || null, height: image.naturalHeight || null };
  } catch {
    throw new LogoRefused("That SVG does not draw as a picture. Export it again, or use a PNG.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Checks a logo and shrinks a larger raster picture to 512 px on its long
 * side, keeping its type. An SVG is kept as drawn. Throws LogoRefused with a
 * sentence that says what to change.
 */
export async function prepareLogo(file: File): Promise<Logo> {
  const type = logoType(file);
  if (type === null) {
    throw new LogoRefused("The logo has to be a PNG, JPEG, WEBP or SVG.");
  }
  if (type === "image/svg+xml") {
    if (file.size > MAX_LOGO_BYTES) {
      throw new LogoRefused(`That SVG is ${sizeWords(file.size)} and the limit is 1 MB.`);
    }
    const { width, height } = await svgSize(file);
    return { file, type, bytes: file.size, width, height, shrunkFrom: null };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new LogoRefused(`That picture is ${sizeWords(file.size)}. Pick one under 1 MB, ideally 512 by 512.`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new LogoRefused(`That file does not open as a ${LOGO_TYPES[type]}. Export it again and pick it once more.`);
  }
  const { width, height } = bitmap;
  const longSide = Math.max(width, height);
  if (longSide <= LOGO_EDGE) {
    bitmap.close();
    if (file.size > MAX_LOGO_BYTES) {
      throw new LogoRefused(`That picture is ${sizeWords(file.size)} and the limit is 1 MB.`);
    }
    return { file, type, bytes: file.size, width, height, shrunkFrom: null };
  }

  const scale = LOGO_EDGE / longSide;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    throw new LogoRefused("This browser would not shrink the picture. Pick one 512 px across or smaller.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, outWidth, outHeight);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (blob === null || blob.type !== type) {
    throw new LogoRefused(`This browser cannot write a ${LOGO_TYPES[type]}. Pick a PNG 512 px across or smaller.`);
  }
  if (blob.size > MAX_LOGO_BYTES) {
    throw new LogoRefused(`Even at 512 px the picture is ${sizeWords(blob.size)}. Save it with fewer colours, or as a JPEG.`);
  }
  const base = file.name.replace(/\.[^.]+$/, "") || "logo";
  const ending = type === "image/jpeg" ? "jpg" : type.slice("image/".length);
  return {
    file: new File([blob], `${base}-${LOGO_EDGE}.${ending}`, { type }),
    type,
    bytes: blob.size,
    width: outWidth,
    height: outHeight,
    shrunkFrom: longSide,
  };
}

/** A link as typed, made whole: `site.com` becomes https://site.com. Null for an empty box. */
function asUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/** The website as it will be stored, or a sentence saying what is wrong with it. Empty is allowed. */
export function checkWebsite(text: string): { url: string | null; refusal: string | null } {
  if (text.trim() === "") {
    return { url: null, refusal: null };
  }
  const url = asUrl(text);
  if (url === null || url.protocol !== "https:" || !url.hostname.includes(".") || url.username !== "" || url.password !== "") {
    return { url: null, refusal: "The website has to be an https address, like https://yourcompany.com." };
  }
  if (url.href.length > MAX_LINK) {
    return { url: null, refusal: `The website address is longer than ${MAX_LINK} characters.` };
  }
  return { url: url.href, refusal: null };
}

/** The X profile as it will be stored, or a sentence saying what is wrong. `@name` and a bare name both work. */
export function checkX(text: string): { url: string | null; refusal: string | null } {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { url: null, refusal: null };
  }
  const handle = /^@?([A-Za-z0-9_]{1,15})$/.exec(trimmed);
  if (handle !== null) {
    return { url: `https://x.com/${handle[1]}`, refusal: null };
  }
  const url = asUrl(trimmed);
  const host = url?.hostname.replace(/^(www\.|mobile\.)/, "");
  const path = url === null ? null : /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(url.pathname);
  if (url === null || url.protocol !== "https:" || (host !== "x.com" && host !== "twitter.com") || path === null) {
    return { url: null, refusal: "The X link has to be a profile, like https://x.com/yourcompany or @yourcompany." };
  }
  return { url: `https://x.com/${path[1]}`, refusal: null };
}

/**
 * The Metaplex token metadata JSON: name, symbol, description, image,
 * external_url for the website, and the image again under properties.files.
 * The website and X profile also go under `extensions`, where the Solana token
 * list convention puts social links and several explorers look for them.
 * Without a logo the image and properties are left out rather than faked.
 */
export function metadataJson(
  text: { name: string; symbol: string; description: string; links: MetadataLinks },
  image: { uri: string; type: string } | null
): Record<string, unknown> {
  const website = text.links.website ?? null;
  const x = text.links.x ?? null;
  const extensions: Record<string, string> = {};
  if (website !== null) {
    extensions.website = website;
  }
  if (x !== null) {
    extensions.twitter = x;
  }
  return {
    name: text.name,
    symbol: text.symbol,
    description: text.description,
    ...(image !== null ? { image: image.uri } : {}),
    ...(website !== null ? { external_url: website } : {}),
    ...(image !== null
      ? {
          properties: {
            files: [{ uri: image.uri, type: image.type }],
            category: "image",
          },
        }
      : {}),
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };
}

function textKeyOf(input: Omit<MetadataInput, "image">): string {
  return JSON.stringify([input.name, input.symbol, input.description, input.links.website ?? null, input.links.x ?? null]);
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What Irys charges, in lamports, to store one file of this many bytes. */
async function priceOne(bytes: number): Promise<number> {
  const answer = await fetch(`${STORAGE.node}/price/solana/${Math.ceil(bytes) + ITEM_HEADER_BYTES}`, { cache: "no-store" });
  const text = (await answer.text()).trim();
  const lamports = Number(text);
  if (!answer.ok || !/^\d+$/.test(text) || !Number.isSafeInteger(lamports)) {
    throw new Error(`Irys did not give a price (answered ${answer.status})`);
  }
  return lamports;
}

/**
 * What Irys charges, in lamports, to store the logo, when there is one, and
 * the JSON, asked of the node itself. The JSON's size is worked out from a
 * JSON of the real length.
 */
export async function storagePrice(logoBytes: number | null, text: Omit<MetadataInput, "image">): Promise<number> {
  const stand = logoBytes === null ? null : { uri: `${STORAGE.gateway}/${"x".repeat(44)}`, type: "image/svg+xml" };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(metadataJson(text, stand))).length;
  const [logo, json] = await Promise.all([logoBytes === null ? 0 : priceOne(logoBytes), priceOne(jsonBytes)]);
  return logo + json;
}

type Irys = Awaited<ReturnType<typeof connectIrys>>;

async function connectIrys(wallet: MetadataWallet) {
  const [{ WebUploader }, { WebSolana }] = await Promise.all([
    import("@irys/web-upload"),
    import("@irys/web-upload-solana"),
  ]);
  const provider = {
    publicKey: wallet.publicKey,
    signMessage: (message: Uint8Array) => wallet.signMessage(message),
    sendTransaction: (transaction: Transaction, connection: Connection, options?: SendOptions) =>
      wallet.sendTransaction(transaction, connection, options),
  };
  return WebUploader(WebSolana).withProvider(provider).withRpc(browserRpcUrl()).bundlerUrl(STORAGE.node).timeout(60_000).build();
}

async function balanceOf(irys: Irys): Promise<number> {
  return Number((await irys.getBalance()).toString());
}

async function waitForCredit(irys: Irys, needed: number): Promise<void> {
  const until = Date.now() + CREDIT_WAIT_MS;
  while (Date.now() < until) {
    if ((await balanceOf(irys)) >= needed) {
      return;
    }
    await new Promise((wake) => setTimeout(wake, CREDIT_POLL_MS));
  }
  throw new Error("Irys has not credited the funding transfer after two minutes");
}

/** The funding transfer's signature, out of the error Irys throws when it could not tell its node about one. */
export function unsentFundOf(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  return /failed to post funding tx - ([1-9A-HJ-NP-Za-km-z]{64,90})/.exec(text)?.[1] ?? null;
}

/**
 * Stores the logo and then the metadata JSON that points at it, and returns
 * the JSON's address.
 *
 * The logo is checked and shrunk first. Both files are priced by Irys, and the
 * wallet funds its Irys balance only by what that balance lacks for them: one
 * transfer, or none when the balance already covers it. Irys then asks the
 * wallet to sign each file, the logo and then the JSON, which has to name the
 * logo's address and so cannot be signed first.
 *
 * With `previous` from an earlier press of this launch, a logo with the same
 * bytes is not stored twice, and neither is a JSON whose every word matches.
 * Without a logo only the JSON is priced, signed and stored.
 */
export async function uploadMetadata(
  wallet: MetadataWallet,
  input: MetadataInput,
  options: UploadOptions = {}
): Promise<StoredMetadata> {
  const say = options.onStage ?? (() => {});
  const text = { name: input.name, symbol: input.symbol, description: input.description, links: input.links };
  const textKey = textKeyOf(text);
  const logo = input.image === null ? null : await prepareLogo(input.image);
  const imageSha = logo === null ? "" : await sha256(await logo.file.arrayBuffer());
  const imageType = logo?.type ?? "";
  const previous = options.previous ?? null;
  const logoKept =
    previous !== null &&
    previous.imageSha === imageSha &&
    previous.imageType === imageType &&
    (logo === null || previous.imageUri !== "");
  if (logoKept && previous.uri !== "" && previous.textKey === textKey) {
    say({ stage: "stored", uri: previous.uri });
    return previous;
  }

  say({ stage: "pricing" });
  const irys = await connectIrys(wallet);
  if (options.unsentFund) {
    await irys.funder.submitFundTransaction(options.unsentFund).catch(() => {
      // The node may already know it; the balance read below says what counts.
    });
  }
  const stand = logo === null ? null : { uri: `${STORAGE.gateway}/${"x".repeat(44)}`, type: logo.type };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(metadataJson(text, stand))).length;
  const logoPrice = logo === null || logoKept ? 0 : await priceOne(logo.bytes);
  const price = logoPrice + (await priceOne(jsonBytes));
  if (price > MAX_STORAGE_LAMPORTS) {
    throw new StorageTooDear(price);
  }
  const held = await balanceOf(irys);
  const shortfall = Math.max(0, price - held);
  say({ stage: "priced", lamports: price, shortfall });

  let fundSignature: string | null = null;
  if (shortfall > 0) {
    say({ stage: "funding", lamports: shortfall });
    const funded = await irys.fund(shortfall);
    fundSignature = funded.id;
    say({ stage: "crediting", signature: funded.id });
    await waitForCredit(irys, price);
  }

  let imageUri = "";
  if (logo !== null) {
    if (logoKept) {
      imageUri = previous.imageUri;
    } else {
      say({ stage: "uploading", file: "logo" });
      const stored = await irys.uploadFile(logo.file, { tags: [{ name: "Content-Type", value: logo.type }] });
      imageUri = `${STORAGE.gateway}/${stored.id}`;
    }
    say({ stage: "logo-stored", imageUri, imageType: logo.type, imageSha });
  }

  say({ stage: "uploading", file: "description" });
  const json = JSON.stringify(metadataJson(text, logo === null ? null : { uri: imageUri, type: logo.type }));
  const stored = await irys.upload(json, { tags: [{ name: "Content-Type", value: "application/json" }] });
  const uri = `${STORAGE.gateway}/${stored.id}`;
  say({ stage: "stored", uri });
  return {
    uri,
    imageUri,
    imageType,
    imageSha,
    textKey,
    priceLamports: price,
    fundSignature,
    fundLamports: shortfall,
  };
}

function httpsUrl(value: unknown, max = 2048): string | null {
  if (typeof value !== "string" || value.length > max) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() !== "" && value.length <= max ? value : null;
}

/**
 * Fetches a token's metadata JSON and checks it: an https address, an answer
 * within eight seconds and 64 KB, a name and a symbol. The image is kept only
 * when it is an https address and is null otherwise. Returns null for anything
 * else and never throws, so a page can call it for any token and fall back to
 * its own mark.
 *
 * Everything in it was typed by an issuer and is shown as a label only.
 */
export async function readMetadata(uri: string | null | undefined, timeoutMs = READ_TIMEOUT_MS): Promise<TokenMetadata | null> {
  const address = httpsUrl(uri);
  if (address === null) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const answer = await fetch(address, { signal: controller.signal, redirect: "follow" });
    if (!answer.ok) {
      return null;
    }
    const length = Number(answer.headers.get("content-length") ?? "0");
    if (length > MAX_METADATA_BYTES) {
      return null;
    }
    const body = await answer.text();
    if (body.length > MAX_METADATA_BYTES) {
      return null;
    }
    const json: unknown = JSON.parse(body);
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      return null;
    }
    const record = json as Record<string, unknown>;
    const name = shortText(record.name, 200);
    const symbol = shortText(record.symbol, 40);
    const image = httpsUrl(record.image);
    if (name === null || symbol === null) {
      return null;
    }
    const extensions =
      typeof record.extensions === "object" && record.extensions !== null
        ? (record.extensions as Record<string, unknown>)
        : {};
    return {
      uri: address,
      name,
      symbol,
      description: shortText(record.description, 2000),
      image,
      website: httpsUrl(record.external_url, MAX_LINK) ?? httpsUrl(extensions.website, MAX_LINK),
      x: httpsUrl(extensions.twitter, MAX_LINK),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
