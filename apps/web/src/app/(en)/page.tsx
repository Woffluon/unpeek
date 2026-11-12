import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { HomePageView } from "@/components/home-page-view";

export const metadata: Metadata = buildPageMetadata({
  locale: "en",
  enRoute: "/",
  absoluteTitle: "unpeek | Client-side JS protection with a frame budget",
  description:
    "unpeek reads the call graph before it rewrites a bundle. Hot-path functions stay untouched, so protection costs under 2% CPU and under 15% gzip.",
});

export default function EnglishHomePage() {
  return <HomePageView locale="en" />;
}
