import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { CSSProperties, ReactNode } from "react";

import "@/components/docs/docs-theme.css";
import { CurveMark } from "@/components/hero/curve-mark";
import { source } from "@/lib/docs-source";

// The site's own nav is 64px tall and sticky, so the sidebar and the "on this
// page" column have to start below it instead of at the top of the window.
const belowSiteNav = {
  "--fd-banner-height": "4rem",
  "--fd-docs-height": "calc(100dvh - 4rem)",
} as CSSProperties;

export default function DocsRouteLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{ enabled: false }}
      search={{ options: { api: "/docs/api/search" } }}
    >
      <DocsLayout
        tree={source.getPageTree()}
        containerProps={{ style: belowSiteNav }}
        nav={{
          url: "/docs",
          title: (
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
              <CurveMark className="h-4 w-4" />
              Pangu docs
            </span>
          ),
        }}
        links={[
          {
            type: "main",
            text: "The sale",
            url: "/",
            active: "none",
          },
        ]}
        sidebar={{ collapsible: false }}
        themeSwitch={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
