import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/docs-source";

// The search index is built from the same pages the sidebar lists. It sits
// under /docs so the whole documentation lives in one route folder.
export const { GET } = createFromSource(source);
