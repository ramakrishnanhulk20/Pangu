import { loader } from "fumadocs-core/source";

import { docs } from "@/.source/server";

// Every page under content/docs, resolved to a /docs URL and a sidebar tree.
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
