import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { DocsHubView } from "@/components/docs-hub-view";

export const metadata: Metadata = buildPageMetadata({
  locale: "en",
  enRoute: "/docs/",
  title: "Documentation",
  description:
    "CLI flags, bundler adapters, hot-path heuristics, the source map vault, and the programmatic API for unpeek.",
});

export default function EnglishDocsHubPage() {
  return <DocsHubView locale="en" />;
}
