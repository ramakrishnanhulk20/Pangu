import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { docsMdxComponents } from "@/components/docs/mdx-components";
import { PageRise } from "@/components/docs/page-rise";
import { source } from "@/lib/docs-source";

type DocsParams = { params: Promise<{ slug?: string[] }> };

export default async function DocsContentPage({ params }: DocsParams) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const Content = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <PageRise>
          <Content components={docsMdxComponents()} />
        </PageRise>
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: DocsParams): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return {
    title: `${page.data.title} | Pangu docs`,
    description: page.data.description,
  };
}
