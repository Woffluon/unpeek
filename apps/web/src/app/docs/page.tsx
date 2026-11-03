"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowLeft, ArrowUpRight } from "@phosphor-icons/react";
import { DICTIONARY, type Locale } from "@/content/i18n";
import { DocsReader } from "@/components/docs-reader";

export default function DocsPage() {
  const [locale, setLocale] = useState<Locale>("en");
  const dict = DICTIONARY[locale];

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 h-16 border-b border-zinc-800 bg-[#09090b]/95 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 text-zinc-100 font-mono text-base font-semibold tracking-tight"
            >
              <span className="w-6 h-6 flex items-center justify-center border border-emerald-500/60 bg-emerald-500/10 text-emerald-400">
                <ShieldCheck size={15} weight="bold" />
              </span>
              <span>unpeek</span>
              <span className="font-mono text-xs text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5">
                /docs
              </span>
            </Link>

            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <ArrowLeft size={13} weight="regular" />
              <span>{dict.docsHeader.backToHomeLabel}</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <div
              role="group"
              aria-label="Language Switcher"
              className="inline-flex items-center border border-zinc-800 bg-zinc-950 p-0.5 font-mono text-xs"
            >
              <button
                type="button"
                onClick={() => setLocale("en")}
                className={`px-2.5 py-1 transition-colors ${
                  locale === "en"
                    ? "bg-emerald-500 text-zinc-950 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLocale("tr")}
                className={`px-2.5 py-1 transition-colors ${
                  locale === "tr"
                    ? "bg-emerald-500 text-zinc-950 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                TR
              </button>
            </div>

            <a
              href="https://github.com/Woffluon/unpeek"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors"
            >
              <span>{dict.nav.github}</span>
              <ArrowUpRight size={14} weight="regular" className="text-zinc-400" />
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 lg:py-16">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="space-y-3 border-b border-zinc-800 pb-8">
            <div className="font-mono text-xs text-emerald-400">
              unpeek {dict.meta.version} · {dict.docsHeader.onPageLabel}
            </div>
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-zinc-100">
              {dict.docsHeader.title}
            </h1>
            <p className="text-base text-zinc-400 leading-relaxed max-w-[68ch]">
              {dict.docsHeader.subtitle}
            </p>
          </div>

          <DocsReader dict={dict} />
        </div>
      </main>

      <footer className="border-t border-zinc-800 bg-[#09090b] py-8">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs font-mono text-zinc-400">
          <span>{dict.footer.tagline}</span>
          <Link href="/" className="text-emerald-400 hover:underline">
            {dict.docsHeader.backToHomeLabel}
          </Link>
        </div>
      </footer>
    </div>
  );
}
