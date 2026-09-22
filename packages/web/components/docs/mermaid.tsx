"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";

type Drawing = { kind: "drawn"; svg: string } | { kind: "failed" };

function readToken(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value.length > 0 ? value : fallback;
}

/**
 * A diagram written as a ```mermaid fence in the markdown. The remark plugin in
 * source.config.ts turns those fences into this component.
 *
 * Mermaid is about half a megabyte, so it is only fetched once the diagram is
 * close to the viewport. If it fails for any reason the reader still gets the
 * diagram's source instead of an empty box.
 */
export function Mermaid({ chart }: { chart: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const rawId = useId();
  const [near, setNear] = useState(false);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setNear(true));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let live = true;

    import("mermaid")
      .then(async ({ default: mermaid }) => {
        const ink = readToken("--ink", "#14140f");
        const paper = readToken("--paper", "#f6f5f0");
        const raised = readToken("--raised", "#fcfbf7");
        const line = readToken("--motif-line", ink);
        const muted = readToken("--muted", "#6c6c60");

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: "var(--font-plex-sans), ui-sans-serif, sans-serif",
          themeVariables: {
            background: paper,
            primaryColor: raised,
            primaryTextColor: ink,
            primaryBorderColor: line,
            secondaryColor: paper,
            tertiaryColor: paper,
            secondaryBorderColor: line,
            tertiaryBorderColor: line,
            lineColor: line,
            textColor: ink,
            mainBkg: raised,
            nodeBorder: line,
            clusterBkg: paper,
            clusterBorder: line,
            titleColor: ink,
            edgeLabelBackground: paper,
            labelBoxBkgColor: raised,
            labelBoxBorderColor: line,
            actorBkg: raised,
            actorBorder: line,
            actorTextColor: ink,
            actorLineColor: line,
            signalColor: ink,
            signalTextColor: ink,
            loopTextColor: ink,
            noteBkgColor: paper,
            noteBorderColor: line,
            noteTextColor: muted,
            sequenceNumberColor: paper,
          },
        });

        // A stable, CSS-safe id: React ids carry colons, which break selectors.
        const { svg } = await mermaid.render(
          `pangu-diagram-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`,
          chart
        );
        // Mermaid writes the drawing's natural width as a max-width and then
        // stretches the picture to the box. Pinning the width to that same
        // number keeps the labels readable and lets the box scroll instead.
        const sized = svg.replace(
          /max-width:\s*([\d.]+)px;/,
          "max-width:$1px;width:$1px;"
        );
        if (live) setDrawing({ kind: "drawn", svg: sized });
      })
      .catch(() => {
        if (live) setDrawing({ kind: "failed" });
      });

    return () => {
      live = false;
    };
  }, [chart, near, rawId, resolvedTheme]);

  return (
    <div
      ref={frame}
      data-diagram
      className="not-prose my-8 overflow-hidden rounded-lg border border-line bg-raised"
    >
      {drawing?.kind === "drawn" ? (
        <div
          className="max-h-[78vh] overflow-auto p-4"
          // The markup comes from Mermaid's own sanitised renderer, run on a
          // diagram that ships with this repository.
          dangerouslySetInnerHTML={{ __html: drawing.svg }}
        />
      ) : null}

      {drawing === null ? (
        <p className="px-4 py-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {near ? "Drawing the diagram" : "Diagram"}
        </p>
      ) : null}

      {drawing?.kind === "failed" ? (
        <figure className="m-0">
          <figcaption className="border-b border-line px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            Diagram source
          </figcaption>
          <pre className="m-0 overflow-x-auto bg-transparent p-4 text-xs leading-relaxed text-ink">
            <code>{chart}</code>
          </pre>
        </figure>
      ) : null}
    </div>
  );
}
