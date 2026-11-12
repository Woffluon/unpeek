import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { DocsHubView } from "@/components/docs-hub-view";

export const metadata: Metadata = buildPageMetadata({
  locale: "tr",
  enRoute: "/docs/",
  title: "Dokümantasyon",
  description:
    "unpeek için CLI bayrakları, bundler adaptörleri, hot-path sezgileri, source map kasası ve programatik API referansı.",
});

export default function TurkishDocsHubPage() {
  return <DocsHubView locale="tr" />;
}
