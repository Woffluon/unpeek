import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "CLI flags, bundler adapters, hot-path heuristics, the source map vault, and the programmatic API for unpeek.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
