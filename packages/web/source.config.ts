import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins/remark-mdx-mermaid";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    // Turns every ```mermaid fence into <Mermaid chart="..." />, which the
    // component in components/docs draws in the browser.
    remarkPlugins: (plugins) => [remarkMdxMermaid, ...plugins],
  },
});
