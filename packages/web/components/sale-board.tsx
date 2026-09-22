import { readBoard } from "@/lib/board";

import { SaleRows, type SaleRow } from "./sale-rows";

/**
 * Every number below comes back off devnet on each request. The mints come
 * from the scripts' own record of what they opened, nothing else.
 */
export async function SaleBoard() {
  let rows: SaleRow[];
  try {
    rows = await readBoard();
  } catch (error) {
    return (
      <p className="border-y border-line py-5 text-sm text-muted">
        Devnet did not answer, so there is nothing true to show yet. Reload to
        try again.{" "}
        <span className="opacity-60">
          {error instanceof Error ? error.message : "unknown error"}
        </span>
      </p>
    );
  }

  return <SaleRows rows={rows} />;
}
