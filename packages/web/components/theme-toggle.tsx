"use client";

import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // The server cannot know which theme the browser resolved, so both labels
  // are rendered and CSS shows the right one. Nothing to hydrate, no flash.
  return (
    <button
      type="button"
      aria-label="Switch between light and dark"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="h-9 rounded-lg border border-line px-3 text-xs uppercase tracking-[0.14em] text-muted transition-colors hover:border-ink hover:text-ink"
    >
      <span className="dark:hidden">Dark</span>
      <span className="hidden dark:inline">Light</span>
    </button>
  );
}
