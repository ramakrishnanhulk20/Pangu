/**
 * Pangu's mark: the curve, the cap it runs into, and one wallet's share sitting
 * under that cap. The same drawing as the hero motif, cut down to 24px. It is
 * the nav mark and, as app/icon.svg, the favicon.
 */
export function CurveMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 21C7.2 20.4 11.4 17.6 14.4 12.4C16.4 8.9 17.6 5.6 18.2 2"
        stroke="var(--motif-line)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M4 8.4H21" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="15.3" cy="10.6" r="2.7" fill="var(--accent)" />
    </svg>
  );
}
