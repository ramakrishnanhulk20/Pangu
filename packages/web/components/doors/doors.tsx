import { ACCESS_MODE } from "pangu-sdk";
import { cache, Suspense } from "react";

import { readDirectory } from "@/lib/directory";
import { CHAIN } from "@/lib/network";

import { DoorsBand, type DoorKey } from "./doors-band";
import { DoorFigure, DoorFigureWaiting } from "./door-figure";

// The four figures come from one read of the sale directory per request, the
// same thirty second reading /api/sales and the sales page serve.
const readOnce = cache(() => readDirectory());

interface Counted {
  value: number;
  label: string;
}

function countFor(door: DoorKey, sales: Awaited<ReturnType<typeof readDirectory>>["sales"]): Counted {
  switch (door) {
    case "buy": {
      const value = sales.filter((sale) => sale.state === "running").length;
      return { value, label: value === 1 ? "sale running now" : "sales running now" };
    }
    case "launch":
      return {
        value: sales.length,
        label: sales.length === 1 ? "sale opened on the program" : "sales opened on the program",
      };
    case "vouch": {
      const value = sales.filter((sale) => sale.accessMode === ACCESS_MODE.verifierCredential).length;
      return { value, label: value === 1 ? "sale asks for a credential" : "sales ask for a credential" };
    }
    case "holdings": {
      // A wallet in two sales is two holdings, so this counts holdings, not people.
      const value = sales.reduce((total, sale) => total + sale.buyers, 0);
      return { value, label: value === 1 ? "holding on record" : "holdings on record" };
    }
  }
}

async function LiveFigure({ door, size }: { door: DoorKey; size: "large" | "small" }) {
  const directory = await readOnce();
  if (directory.failure !== null) {
    // No number stands in for one the chain did not give. The door still opens.
    return <DoorFigure value={null} label={`${CHAIN.atStart} did not answer just now`} size={size} />;
  }
  const { value, label } = countFor(door, directory.sales);
  return <DoorFigure value={value} label={label} size={size} />;
}

function figure(door: DoorKey, size: "large" | "small") {
  // Each figure waits on the chain inside its own boundary, so the band itself
  // is in the first HTML and only the numbers stream in.
  return (
    <Suspense fallback={<DoorFigureWaiting size={size} />}>
      <LiveFigure door={door} size={size} />
    </Suspense>
  );
}

/** The front page's last band: the four things a visitor can do next, each with one live count. */
export function Doors() {
  return (
    <DoorsBand
      figures={{
        buy: figure("buy", "large"),
        launch: figure("launch", "small"),
        vouch: figure("vouch", "small"),
        holdings: figure("holdings", "small"),
      }}
    />
  );
}
