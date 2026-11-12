import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildPageMetadata, getDocSection, getDocSlugs } from "@/lib/seo";
import { DocArticleView } from "@/components/doc-article-view";

export const dynamicParams = false;

export function generateStaticParams() {
  return getDocSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const section = getDocSection("en", slug);
  if (!section) return {};

  return buildPageMetadata({
    locale: "en",
    enRoute: `/docs/${section.id}/`,
    title: section.title,
    description: section.summary,
    type: "article",
  });
}

export default async function EnglishDocArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const section = getDocSection("en", slug);
  if (!section) notFound();

  return <DocArticleView locale="en" section={section} />;
}
