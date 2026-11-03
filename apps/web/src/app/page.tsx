"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  TerminalWindow,
  Copy,
  Check,
  ArrowRight,
  GitBranch,
  Cpu,
  LockKey,
  FileCode,
  ArrowUpRight,
} from "@phosphor-icons/react";
import { CODE_SAMPLES, DICTIONARY, type Locale } from "@/content/i18n";
import { DocsReader } from "@/components/docs-reader";

export default function HomePage() {
  const [locale, setLocale] = useState<Locale>("en");
  const [activeCodeTab, setActiveCodeTab] = useState<"before" | "after">("after");
  const [copiedInit, setCopiedInit] = useState(false);

  const dict = DICTIONARY[locale];

  const handleCopyInit = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(dict.hero.initCmd);
      setCopiedInit(true);
      setTimeout(() => setCopiedInit(false), 1800);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col">
      {/* Single-line h-16 Top Navigation */}
      <header className="sticky top-0 z-40 h-16 border-b border-zinc-800 bg-[#09090b]/95 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <a
              href="#"
              className="inline-flex items-center gap-2.5 text-zinc-100 font-mono text-base font-semibold tracking-tight"
            >
              <span className="w-6 h-6 flex items-center justify-center border border-emerald-500/60 bg-emerald-500/10 text-emerald-400">
                <ShieldCheck size={15} weight="bold" />
              </span>
              <span>unpeek</span>
              <span className="hidden sm:inline-block font-mono text-xs text-zinc-400 border border-zinc-800 bg-zinc-900 px-1.5 py-0.5">
                {dict.meta.version}
              </span>
            </a>

            <nav className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
              <a
                href="#architecture"
                className="hover:text-zinc-100 transition-colors whitespace-nowrap"
              >
                {dict.nav.architecture}
              </a>
              <a
                href="#benchmarks"
                className="hover:text-zinc-100 transition-colors whitespace-nowrap"
              >
                {dict.nav.benchmarks}
              </a>
              <a
                href="#docs"
                className="hover:text-zinc-100 transition-colors whitespace-nowrap"
              >
                {dict.nav.docs}
              </a>
              <Link
                href="/docs"
                className="inline-flex items-center gap-1 text-zinc-300 hover:text-emerald-400 transition-colors whitespace-nowrap font-mono text-xs"
              >
                <span>/docs</span>
                <ArrowUpRight size={13} weight="regular" />
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* EN | TR Language Switcher */}
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors whitespace-nowrap"
            >
              <span>{dict.nav.github}</span>
              <ArrowUpRight size={14} weight="regular" className="text-zinc-400" />
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section: Fits initial viewport (min-h-[calc(100dvh-4rem)]), Split Left Copy / Right Code Comparison */}
        <section className="min-h-[calc(100dvh-4rem)] flex items-center border-b border-zinc-800 py-12 lg:py-16">
          <div className="max-w-[1400px] mx-auto w-full px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
              {/* Left Column: Strictly 4 Text Elements (1. Eyebrow, 2. Headline, 3. Subtext <=20w, 4. CTAs) */}
              <div className="lg:col-span-5 space-y-6">
                {/* Element 1: Eyebrow (1 of 2 allowed on page) */}
                <div className="inline-flex items-center gap-2 px-2.5 py-1 border border-zinc-800 bg-zinc-950">
                  <span className="w-1.5 h-1.5 bg-emerald-500" />
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-400">
                    {dict.hero.eyebrow}
                  </span>
                </div>

                {/* Element 2: Headline (2 lines max on desktop) */}
                <h1 className="text-4xl sm:text-5xl xl:text-[52px] font-semibold tracking-tighter leading-[1.06] text-zinc-100">
                  <span className="block">{dict.hero.headlineLine1}</span>
                  <span className="block text-zinc-400">{dict.hero.headlineLine2}</span>
                </h1>

                {/* Element 3: Subtext (<= 20 words) */}
                <p className="text-base md:text-lg text-zinc-400 leading-relaxed max-w-[54ch]">
                  {dict.hero.subtext}
                </p>

                {/* Element 4: CTAs (1-Click Copy Terminal Command + Read Documentation CTA) */}
                <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCopyInit}
                    aria-label={dict.hero.initCmd}
                    className="group flex items-center justify-between gap-4 px-4 py-3 border border-zinc-700 hover:border-emerald-500/70 bg-zinc-950 text-left font-mono text-sm transition-colors active:scale-[0.98]"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="text-emerald-400 select-none">$</span>
                      <span className="text-zinc-100 font-medium whitespace-nowrap">
                        {dict.hero.initCmd}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400 group-hover:text-emerald-400 pl-3 border-l border-zinc-800 whitespace-nowrap">
                      {copiedInit ? (
                        <>
                          <Check size={14} weight="bold" className="text-emerald-400" />
                          <span className="text-emerald-400">{dict.hero.copiedLabel}</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} weight="regular" />
                          <span>{dict.hero.copyLabel}</span>
                        </>
                      )}
                    </span>
                  </button>

                  <a
                    href="#docs"
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium text-sm transition-colors whitespace-nowrap active:scale-[0.98]"
                  >
                    <span>{dict.hero.primaryCta}</span>
                    <ArrowRight size={16} weight="bold" />
                  </a>
                </div>
              </div>

              {/* Right Column: Authentic Before / After AST Transformation Code Comparison */}
              <div className="lg:col-span-7">
                <div className="border border-zinc-800 bg-[#0d0d10]">
                  {/* Code Window Top Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-950">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActiveCodeTab("before")}
                        className={`px-3 py-1.5 text-xs font-mono transition-colors border ${
                          activeCodeTab === "before"
                            ? "border-zinc-700 bg-zinc-900 text-zinc-100"
                            : "border-transparent text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {dict.hero.codeTabs.beforeLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveCodeTab("after")}
                        className={`px-3 py-1.5 text-xs font-mono transition-colors border ${
                          activeCodeTab === "after"
                            ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                            : "border-transparent text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {dict.hero.codeTabs.afterLabel}
                      </button>
                    </div>

                    <div className="inline-flex items-center gap-2 px-2.5 py-1 border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-xs">
                      <TerminalWindow size={14} weight="regular" />
                      <span>{dict.hero.codeTabs.statusBadge}</span>
                    </div>
                  </div>

                  {/* Code Diff / Output Body */}
                  <div className="p-4 sm:p-5 overflow-x-auto max-h-[420px] overflow-y-auto bg-[#09090b]">
                    <pre className="font-mono text-xs leading-relaxed text-zinc-200">
                      <code>
                        {activeCodeTab === "before" ? CODE_SAMPLES.before : CODE_SAMPLES.after}
                      </code>
                    </pre>
                  </div>

                  {/* Bottom Engineering Telemetry Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-zinc-800 border-t border-zinc-800 bg-zinc-950 text-xs font-mono">
                    <div className="px-4 py-2.5 flex items-center gap-2 text-zinc-300">
                      <Cpu size={15} weight="regular" className="text-emerald-400 shrink-0" />
                      <span className="truncate">{dict.hero.codeTabs.hotPathNote}</span>
                    </div>
                    <div className="px-4 py-2.5 flex items-center gap-2 text-zinc-300">
                      <LockKey size={15} weight="regular" className="text-emerald-400 shrink-0" />
                      <span className="truncate">{dict.hero.codeTabs.coldPathNote}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Measured Engineering Budget Strip */}
        <section className="border-b border-zinc-800 bg-[#0b0b0e]">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-zinc-800">
              {dict.metricsStrip.items.map((item, idx) => (
                <div key={idx} className="p-6 lg:p-8 space-y-2">
                  <div className="font-mono text-3xl lg:text-4xl font-semibold text-emerald-400 tracking-tight">
                    {item.value}
                  </div>
                  <div className="text-sm font-medium text-zinc-100">{item.label}</div>
                  <p className="text-xs text-zinc-400 leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Compiler Architecture & Call-Graph Flow Section */}
        <section id="architecture" className="py-20 lg:py-28 border-b border-zinc-800 scroll-mt-16">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            {/* Stacked Vertical Header (Following Split-Header Ban & Eyebrow Cap 2/2) */}
            <div className="space-y-4 max-w-[65ch]">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 border border-zinc-800 bg-zinc-950">
                <GitBranch size={13} weight="regular" className="text-emerald-400" />
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-400">
                  {dict.architectureSection.eyebrow}
                </span>
              </div>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-zinc-100">
                {dict.architectureSection.title}
              </h2>
              <p className="text-base text-zinc-400 leading-relaxed">
                {dict.architectureSection.subtitle}
              </p>
            </div>

            {/* 4-Stage Pipeline Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border border-zinc-800 divide-y md:divide-y-0 md:divide-x divide-zinc-800 bg-[#0d0d10]">
              {dict.architectureSection.stages.map((stage, idx) => (
                <div key={idx} className="p-6 lg:p-7 flex flex-col justify-between space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                      <span className="font-mono text-xs text-emerald-400 font-semibold">
                        {stage.step}
                      </span>
                      <span className="font-mono text-xs text-zinc-400 bg-zinc-900 px-2 py-0.5 border border-zinc-800">
                        {stage.metric}
                      </span>
                    </div>
                    <h3 className="text-lg font-medium text-zinc-100 tracking-tight">
                      {stage.title}
                    </h3>
                    <p className="text-sm text-zinc-400 leading-relaxed">{stage.description}</p>
                  </div>

                  <div className="pt-4 border-t border-zinc-800/70">
                    <p className="font-mono text-xs text-zinc-300 leading-relaxed">
                      {stage.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Measured Benchmark & Tradeoff Matrix Section */}
        <section id="benchmarks" className="py-20 lg:py-28 border-b border-zinc-800 scroll-mt-16">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            <div className="space-y-3 max-w-[65ch]">
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-zinc-100">
                {dict.comparisonSection.title}
              </h2>
              <p className="text-base text-zinc-400 leading-relaxed">
                {dict.comparisonSection.subtitle}
              </p>
            </div>

            <div className="overflow-x-auto border border-zinc-800 bg-[#0d0d10]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-300">
                    <th className="py-4 px-5 border-r border-zinc-800">
                      {dict.comparisonSection.columns.metric}
                    </th>
                    <th className="py-4 px-5 border-r border-zinc-800 text-emerald-400 bg-emerald-500/5">
                      {dict.comparisonSection.columns.unpeek}
                    </th>
                    <th className="py-4 px-5 border-r border-zinc-800 text-zinc-400">
                      {dict.comparisonSection.columns.legacy}
                    </th>
                    <th className="py-4 px-5 text-zinc-400">
                      {dict.comparisonSection.columns.minifier}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-sm">
                  {dict.comparisonSection.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="py-4 px-5 font-medium text-zinc-200 border-r border-zinc-800">
                        {row.metric}
                      </td>
                      <td className="py-4 px-5 font-mono text-xs text-emerald-300 bg-emerald-500/5 border-r border-zinc-800 font-medium">
                        {row.unpeek}
                      </td>
                      <td className="py-4 px-5 font-mono text-xs text-zinc-400 border-r border-zinc-800">
                        {row.legacyObfuscator}
                      </td>
                      <td className="py-4 px-5 font-mono text-xs text-zinc-400">
                        {row.plainMinifier}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Full Interactive Bilingual Documentation Section */}
        <section id="docs" className="py-20 lg:py-28 scroll-mt-16">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="space-y-3 max-w-[65ch]">
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-zinc-100">
                  {dict.docsHeader.title}
                </h2>
                <p className="text-base text-zinc-400 leading-relaxed">
                  {dict.docsHeader.subtitle}
                </p>
              </div>

              <Link
                href="/docs"
                className="inline-flex items-center gap-2 px-4 py-2.5 border border-zinc-800 bg-zinc-950 hover:border-emerald-500/60 text-xs font-mono text-zinc-200 hover:text-emerald-400 transition-colors self-start md:self-auto whitespace-nowrap"
              >
                <FileCode size={15} weight="regular" className="text-emerald-400" />
                <span>{dict.docsHeader.openStandaloneLabel}</span>
                <ArrowUpRight size={14} weight="regular" />
              </Link>
            </div>

            <DocsReader dict={dict} />
          </div>
        </section>
      </main>

      {/* Monochrome Engineering Footer */}
      <footer className="border-t border-zinc-800 bg-[#09090b] py-10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 font-mono text-sm font-semibold text-zinc-100">
              <span className="w-2 h-2 bg-emerald-500" />
              <span>unpeek</span>
              <span className="text-zinc-500">·</span>
              <span className="text-xs text-zinc-400 font-normal">{dict.meta.license}</span>
            </div>
            <p className="text-xs text-zinc-400">{dict.footer.tagline}</p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs font-mono text-zinc-400">
            <Link href="/docs" className="hover:text-emerald-400 transition-colors">
              {dict.footer.links.docs}
            </Link>
            <a
              href="https://github.com/Woffluon/unpeek"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-emerald-400 transition-colors"
            >
              {dict.footer.links.github}
            </a>
            <a
              href="https://www.npmjs.com/package/unpeek"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-emerald-400 transition-colors"
            >
              {dict.footer.links.npm}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
