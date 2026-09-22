/** Holds the shape of the list while devnet is answering. */
export function SaleBoardSkeleton() {
  return (
    <ul
      className="divide-y divide-line border-y border-line"
      aria-label="Reading devnet"
    >
      {[0, 1, 2].map((row) => (
        <li key={row} className="py-5">
          <div className="h-4 w-52 animate-pulse rounded bg-line" />
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((field) => (
              <div key={field} className="h-8 animate-pulse rounded bg-line" />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
