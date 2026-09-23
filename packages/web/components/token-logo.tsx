"use client";

import { useEffect, useState } from "react";

import { CurveMark } from "@/components/hero/curve-mark";
import { readMetadata, type TokenMetadata } from "@/lib/token-metadata";

/** A link that did not load is asked again after this long, so one bad moment on the network does not stick for the whole visit. */
const MISS_RETRY_MS = 60_000;

const seen = new Map<string, { at: number; answer: Promise<TokenMetadata | null> }>();

/**
 * A token's metadata, fetched once per link for the life of the page and
 * shared by every logo that shows it. Never rejects.
 */
export function readMetadataOnce(uri: string): Promise<TokenMetadata | null> {
  const known = seen.get(uri);
  if (known !== undefined) {
    return known.answer.then((value) =>
      value === null && Date.now() - known.at > MISS_RETRY_MS ? freshRead(uri) : value
    );
  }
  return freshRead(uri);
}

function freshRead(uri: string): Promise<TokenMetadata | null> {
  const answer = readMetadata(uri);
  seen.set(uri, { at: Date.now(), answer });
  return answer;
}

/**
 * The circle a token's logo sits in, with the site's curve mark standing in
 * when there is no picture. A little grain and an inner shadow sit over the
 * picture so an issuer's flat logo still reads as part of the page.
 */
export function LogoFrame({
  image,
  name,
  size,
  className = "",
  onError,
}: {
  image: string | null;
  name: string;
  size: number;
  className?: string;
  onError?: () => void;
}) {
  return (
    <span
      className={`grain relative isolate inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-raised ${className}`}
      style={{ width: size, height: size }}
    >
      {image !== null ? (
        // Logos live on whatever host the issuer's metadata names, so the
        // image optimiser, which only serves hosts listed in next.config, cannot
        // take them.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={onError}
          className="h-full w-full object-cover"
        />
      ) : (
        <span role="img" aria-label={name} className="grid h-full w-full place-items-center">
          <CurveMark className="h-[56%] w-[56%]" />
        </span>
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_-10px_24px_rgba(0,0,0,0.16)]"
      />
    </span>
  );
}

/**
 * A sale token's logo, read from the metadata link its mint carries, or the
 * site's curve mark in the same circle when there is no link, the link does
 * not load, or the picture does not. The alt text is always the token's name.
 */
export function TokenLogo({
  uri,
  name,
  size = 40,
  className,
}: {
  uri: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
}) {
  const link = uri !== undefined && uri !== null && uri.trim() !== "" ? uri : null;
  const [read, setRead] = useState<{ uri: string; image: string | null } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);

  useEffect(() => {
    if (link === null) {
      return;
    }
    let alive = true;
    readMetadataOnce(link).then((metadata) => {
      if (alive) {
        setRead({ uri: link, image: metadata?.image ?? null });
      }
    });
    return () => {
      alive = false;
    };
  }, [link]);

  const image = link !== null && read !== null && read.uri === link ? read.image : null;
  return (
    <LogoFrame
      image={image !== null && image !== broken ? image : null}
      name={name}
      size={size}
      className={className}
      onError={() => setBroken(image)}
    />
  );
}
