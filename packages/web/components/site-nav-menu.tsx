"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Page = { href: string; label: string };

/**
 * The site's pages on a phone. The bar stays 64px tall at every width, because
 * the docs sidebar and every scroll-to-heading offset are measured from it, so
 * the links open in a panel under the bar instead of taking a second row.
 */
export function SiteNavMenu({ pages }: { pages: readonly Page[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // A tap on a link changes the page, and the panel goes with the old one.
  const [openedOn, setOpenedOn] = useState(pathname);
  if (open && openedOn !== pathname) {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="site-nav-menu"
        onClick={() => {
          setOpenedOn(pathname);
          setOpen((value) => !value);
        }}
        className="rounded-lg border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-ink"
      >
        {open ? "Close" : "Menu"}
      </button>
      {open ? (
        <div
          id="site-nav-menu"
          className="absolute inset-x-0 top-16 border-b border-line bg-paper px-5 py-4"
        >
          <ul className="flex flex-col gap-1">
            {pages.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  onClick={() => setOpen(false)}
                  aria-current={pathname.startsWith(page.href) ? "page" : undefined}
                  className="block rounded-lg px-2 py-3 text-base text-ink transition-colors hover:bg-line/40 aria-[current=page]:text-accent"
                >
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
