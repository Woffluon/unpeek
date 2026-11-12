import type { Metadata } from "next";
import Link from "next/link";
import "@/app/globals.css";
import { fontVariables } from "@/lib/fonts";
import { SITE_URL } from "@/lib/seo";
import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_URL}/`),
  title: "404 | unpeek",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <html lang="en" className={fontVariables}>
      <body className="flex min-h-screen flex-col antialiased">
        <header className="border-b border-rule bg-paper">
          <div className="shell flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5" aria-label="unpeek home">
              <BrandMark className="text-ink" />
              <span className="text-[17px] font-medium leading-none tracking-[-0.02em]">
                unpeek
              </span>
            </Link>
            <Link
              href="/docs/"
              className="text-[13px] leading-none text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              Docs
            </Link>
          </div>
        </header>

        <main id="main" className="shell flex flex-1 flex-col justify-center py-20">
          <div className="max-w-[54ch]">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
              HTTP 404
            </div>
            <h1 className="display mt-3 text-[44px] text-ink sm:text-[64px]">
              Page not found.
            </h1>
            <p className="mt-4 text-[15px] leading-7 text-ink-2">
              The requested path is outside the client bundle map or has moved to a dedicated
              documentation route.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="inline-flex items-center rounded-[3px] bg-ink px-4 py-3 font-mono text-[12px] leading-none text-paper transition-colors duration-150 hover:bg-carbon-2"
              >
                Back to home
              </Link>
              <Link
                href="/docs/"
                className="inline-flex items-center rounded-[3px] border border-rule px-4 py-3 font-mono text-[12px] leading-none text-ink transition-colors duration-150 hover:bg-paper-2"
              >
                Browse documentation
              </Link>
              <Link
                href="/tr/"
                className="inline-flex items-center rounded-[3px] border border-rule px-4 py-3 font-mono text-[12px] leading-none text-ink-2 transition-colors duration-150 hover:bg-paper-2 hover:text-ink"
              >
                Türkçe
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
