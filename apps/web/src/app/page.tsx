"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DICTIONARY } from "@/content/i18n";
import { useLocale } from "@/lib/use-locale";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CallGraphLab } from "@/components/call-graph-lab";
import { SourceTicker } from "@/components/source-ticker";
import { HighlightedCode } from "@/components/syntax-highlight";

// Bars share one scale per row: the signal bar is the measured unpeek figure
// drawn against the legacy upper bound, so its width is the real ratio.
const COMPARE_SHARE = [(2 / 850) * 100, (14 / 340) * 100];


export default function HomePage() {
  const [locale, setLocale] = useLocale();
  const dict = DICTIONARY[locale];
  const [copied, setCopied] = useState(false);
  const [installCopied, setInstallCopied] = useState(false);
  const heroTimer = useRef<number | null>(null);
  const installTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (heroTimer.current) window.clearTimeout(heroTimer.current);
      if (installTimer.current) window.clearTimeout(installTimer.current);
    };
  }, []);

  const copyHero = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(dict.hero.initCmd);
    setCopied(true);
    if (heroTimer.current) window.clearTimeout(heroTimer.current);
    heroTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [dict.hero.initCmd]);

  const copyInstall = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(dict.installSection.command);
    setInstallCopied(true);
    if (installTimer.current) window.clearTimeout(installTimer.current);
    installTimer.current = window.setTimeout(() => setInstallCopied(false), 1600);
  }, [dict.installSection.command]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader dict={dict} locale={locale} onLocaleChange={setLocale} />

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="border-b border-rule lg:flex lg:min-h-[calc(100vh-4rem)] lg:flex-col lg:justify-between">
          <div className="shell flex flex-1 flex-col justify-center py-10 lg:py-12">
            <h1 className="display py-6 text-[clamp(44px,7.2vw,96px)] text-ink sm:py-8 lg:py-10">
              <span className="block">{dict.hero.headlineTop}</span>
              <span className="mt-2 block text-ink-2">{dict.hero.headlineBottom}</span>
            </h1>

            <div className="grid grid-cols-1 gap-10 border-t border-rule pt-8 pb-4 lg:grid-cols-12 lg:gap-14 lg:pt-10 lg:pb-6">
              <div className="lg:col-span-6">
                <p className="max-w-[48ch] text-[15px] leading-7 text-ink-2 sm:text-[16px]">
                  {dict.hero.subtext}
                </p>

                <div className="mt-8 flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={copyHero}
                    className="group flex items-center justify-between gap-6 rounded-[3px] bg-ink px-3.5 py-3 text-left transition-colors duration-150 hover:bg-carbon-2 active:scale-[0.99]"
                  >
                    <span className="flex items-center gap-2 font-mono text-[13px] text-paper">
                      <span className="text-paper/45" aria-hidden="true">
                        $
                      </span>
                      {dict.hero.initCmd}
                    </span>
                    <span className="shrink-0 border-l border-paper/20 pl-3 font-mono text-[11px] text-paper/70">
                      {copied ? dict.hero.copiedLabel : dict.hero.copyLabel}
                    </span>
                  </button>

                  <a
                    href="https://github.com/Woffluon/unpeek"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-[3px] border border-rule px-4 py-3 font-mono text-[12px] leading-none text-ink transition-colors duration-150 hover:bg-paper-2"
                  >
                    {dict.hero.sourceCta}
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10.5px] text-ink-3">
                  <Link
                    href="/docs#doc-architecture"
                    className="underline decoration-rule decoration-1 underline-offset-4 transition-colors duration-150 hover:text-ink"
                  >
                    {dict.hero.secondaryCta}
                  </Link>
                  <a
                    href="https://www.npmjs.com/package/unpeek"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-rule decoration-1 underline-offset-4 transition-colors duration-150 hover:text-ink"
                  >
                    {dict.hero.npmCta}
                  </a>
                </div>
              </div>

              <dl className="lg:col-span-6 lg:pl-12">
                <div className="border-t border-ink">
                  {dict.hero.ledger.map((row) => (
                    <div
                      key={row.label}
                      className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-rule py-3.5"
                    >
                      <dt className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                        {row.label}
                      </dt>
                      <dd className="font-mono text-[12px] text-ink">{row.value}</dd>
                    </div>
                  ))}
                </div>
              </dl>
            </div>
          </div>

          <div>
            <SourceTicker
              sourceLabel={dict.hero.tickerSource}
              protectedLabel={dict.hero.tickerProtected}
            />
            <div className="border-t border-rule bg-paper">
              <div className="shell">
                <div className="grid grid-cols-2 divide-x divide-rule lg:grid-cols-4">
                  {dict.metricsStrip.items.map((item, index) => (
                    <div
                      key={item.label}
                      className={`py-5 lg:py-6 ${index % 2 === 0 ? "pr-4 lg:pr-6" : "pl-4 lg:px-6"} ${
                        index < 2 ? "border-b border-rule lg:border-b-0" : ""
                      } ${index === 0 ? "lg:pl-0" : ""}`}
                    >
                      <div className="tnum font-display text-[28px] leading-none tracking-[-0.03em] text-ink lg:text-[32px]">
                        {item.value}
                      </div>
                      <div className="mt-2 text-[12.5px] leading-snug text-ink-2">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-rule">
                <div className="shell py-2.5">
                  <p className="font-mono text-[10px] leading-4 text-ink-3">
                    {dict.metricsStrip.note}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Parser */}
        <section
          id="parser"
          className="scroll-mt-16 border-b border-rule lg:flex lg:min-h-screen lg:flex-col lg:justify-center"
        >
          <div className="shell py-20 lg:py-0">
            <div className="measure">
              <h2 className="heading text-[32px] text-ink sm:text-[40px]">
                {dict.parserSection.title}
              </h2>
              <p className="mt-4 text-[16px] leading-7 text-ink-2">{dict.parserSection.lead}</p>
            </div>

            <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
              <div className="lg:col-span-4">
                <div className="space-y-8 lg:sticky lg:top-24">
                  <div className="border-t border-ink pt-4">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 bg-signal" aria-hidden="true" />
                      <h3 className="text-[15px] font-medium text-ink">
                        {dict.parserSection.hotTitle}
                      </h3>
                    </div>
                    <p className="mt-2 text-[13.5px] leading-6 text-ink-2">
                      {dict.parserSection.hotBody}
                    </p>
                  </div>

                  <div className="border-t border-rule pt-4">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 bg-ink" aria-hidden="true" />
                      <h3 className="text-[15px] font-medium text-ink">
                        {dict.parserSection.coldTitle}
                      </h3>
                    </div>
                    <p className="mt-2 text-[13.5px] leading-6 text-ink-2">
                      {dict.parserSection.coldBody}
                    </p>
                  </div>
                </div>
              </div>

              <ol className="lg:col-span-8">
                {dict.parserSection.stages.map((stage) => (
                  <li
                    key={stage.step}
                    className="group grid grid-cols-[48px_minmax(0,1fr)] gap-4 border-t border-rule py-5 last:border-b sm:grid-cols-[64px_180px_minmax(0,1fr)] sm:items-baseline"
                  >
                    <span className="tnum font-mono text-[11px] text-ink-3">{stage.step}</span>
                    <span className="text-[15px] font-medium leading-snug text-ink">
                      {stage.title}
                    </span>
                    <span className="col-span-2 text-[13.5px] leading-6 text-ink-2 sm:col-span-1">
                      {stage.detail}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Lab */}
        <section
          id="lab"
          className="scroll-mt-16 border-b border-rule lg:flex lg:min-h-screen lg:flex-col lg:justify-center"
        >
          <div className="shell py-20 lg:py-0">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="measure">
                <h2 className="heading text-[32px] text-ink sm:text-[40px]">{dict.lab.title}</h2>
                <p className="mt-3 text-[16px] leading-7 text-ink-2">{dict.lab.lead}</p>
              </div>
              <div className="flex items-center gap-5 font-mono text-[10.5px] text-ink-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 bg-signal" aria-hidden="true" />
                  {dict.lab.legendHot}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 bg-ink" aria-hidden="true" />
                  {dict.lab.legendCold}
                </span>
              </div>
            </div>

            <div className="mt-10">
              <CallGraphLab dict={dict} />
            </div>
          </div>
        </section>

        {/* Specs */}
        <section
          id="specs"
          className="scroll-mt-16 border-b border-rule lg:flex lg:min-h-screen lg:flex-col lg:justify-center"
        >
          <div className="shell py-20 lg:py-0">
            <div className="measure">
              <h2 className="heading text-[32px] text-ink sm:text-[40px]">
                {dict.specSection.title}
              </h2>
              <p className="mt-4 text-[16px] leading-7 text-ink-2">{dict.specSection.lead}</p>
            </div>

            <dl className="mt-8 border-t border-ink sm:hidden">
              {dict.specSection.rows.map((row) => (
                <div key={row.metric} className="border-b border-rule py-4">
                  <dt className="text-[14px] leading-6 text-ink">{row.metric}</dt>
                  <dd className="mt-1 font-mono text-[12.5px] leading-5 text-ink">{row.value}</dd>
                  <dd className="mt-0.5 font-mono text-[11px] leading-5 text-ink-3">
                    {row.where}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-ink">
                    <th className="py-2.5 pr-4 font-mono text-[10.5px] font-normal uppercase tracking-[0.04em] text-ink-3">
                      {dict.specSection.columns.metric}
                    </th>
                    <th className="py-2.5 pr-4 font-mono text-[10.5px] font-normal uppercase tracking-[0.04em] text-ink-3">
                      {dict.specSection.columns.value}
                    </th>
                    <th className="py-2.5 font-mono text-[10.5px] font-normal uppercase tracking-[0.04em] text-ink-3">
                      {dict.specSection.columns.where}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dict.specSection.rows.map((row) => (
                    <tr
                      key={row.metric}
                      className="border-b border-rule transition-colors duration-150 hover:bg-paper-2"
                    >
                      <td className="py-3.5 pr-4 text-[14px] leading-6 text-ink">{row.metric}</td>
                      <td className="py-3.5 pr-4 font-mono text-[12.5px] leading-6 text-ink">
                        {row.value}
                      </td>
                      <td className="py-3.5 font-mono text-[11.5px] leading-6 text-ink-3">
                        {row.where}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Measured comparison */}
        <section
          id="measured"
          className="scroll-mt-16 border-b border-rule lg:flex lg:min-h-screen lg:flex-col lg:justify-center"
        >
          <div className="shell py-20 lg:py-0">
            <div className="measure">
              <h2 className="heading text-[32px] text-ink sm:text-[40px]">
                {dict.comparisonSection.title}
              </h2>
              <p className="mt-4 text-[16px] leading-7 text-ink-2">
                {dict.comparisonSection.subtitle}
              </p>
            </div>

            <div className="mt-12 border-t border-ink">
              {dict.comparisonSection.rows.slice(0, 2).map((row, index) => (
                <div key={row.metric} className="border-b border-rule py-6">
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                    {row.metric}
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="w-[56px] shrink-0 font-mono text-[10px] text-ink-3">
                        {dict.comparisonSection.barLabels.unpeek}
                      </span>
                      <div className="h-2.5 flex-1 bg-paper-3">
                        <div
                          className="h-full bg-signal"
                          style={{
                            width: `${COMPARE_SHARE[index]}%`,
                            minWidth: "2px",
                          }}
                        />
                      </div>
                      <span className="w-[104px] shrink-0 text-right font-mono text-[11px] leading-4 text-ink sm:w-[150px]">
                        {row.unpeek}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="w-[56px] shrink-0 font-mono text-[10px] text-ink-3">
                        {dict.comparisonSection.barLabels.legacy}
                      </span>
                      <div className="h-2.5 flex-1 bg-paper-3">
                        <div className="h-full w-full bg-ink/30" />
                      </div>
                      <span className="w-[104px] shrink-0 text-right font-mono text-[11px] leading-4 text-ink-2 sm:w-[150px]">
                        {row.legacyObfuscator}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-3 max-w-[64ch] font-mono text-[10.5px] leading-4 text-ink-3">
              {dict.comparisonSection.scaleNote}
            </p>

            <dl className="mt-12 grid grid-cols-1 gap-x-12 gap-y-0 sm:grid-cols-3">
              {dict.comparisonSection.rows.slice(2).map((row) => (
                <div key={row.metric} className="border-t border-rule py-4">
                  <dt className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-ink-3">
                    {row.metric}
                  </dt>
                  <dd className="mt-1.5 text-[13.5px] leading-6 text-ink">{row.unpeek}</dd>
                  <dd className="font-mono text-[11px] leading-5 text-ink-3">
                    {dict.comparisonSection.columns.legacy}: {row.legacyObfuscator}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-8 max-w-[70ch] font-mono text-[10.5px] leading-4 text-ink-3">
              {dict.comparisonSection.note}
            </p>
          </div>
        </section>

        {/* Docs pointer */}
        <section
          id="docs"
          className="scroll-mt-16 border-b border-rule lg:flex lg:min-h-screen lg:flex-col lg:justify-center"
        >
          <div className="shell py-16 lg:py-0">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
              <div className="lg:col-span-5">
                <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                  {dict.docsCta.kicker}
                </div>
                <h2 className="heading mt-3 text-[28px] leading-[1.1] text-ink sm:text-[34px]">
                  {dict.docsCta.title}
                </h2>
                <p className="mt-4 max-w-[46ch] text-[15px] leading-7 text-ink-2">
                  {dict.docsCta.body}
                </p>
                <Link
                  href="/docs"
                  className="mt-7 inline-flex items-center gap-3 rounded-[3px] bg-ink px-4 py-3 font-mono text-[12px] leading-none text-paper transition-colors duration-150 hover:bg-carbon-2"
                >
                  {dict.docsCta.cta}
                  <span aria-hidden="true">→</span>
                </Link>
              </div>

              <ol className="lg:col-span-7 lg:pl-8">
                {dict.docsSections.map((section) => (
                  <li key={section.id} className="border-t border-rule first:border-t-0">
                    <Link
                      href={`/docs#doc-${section.id}`}
                      className="group flex items-baseline gap-5 py-3.5"
                    >
                      <span className="tnum w-6 shrink-0 font-mono text-[10.5px] text-ink-3">
                        {section.number}
                      </span>
                      <span className="flex-1 text-[14px] leading-6 text-ink transition-colors duration-150 group-hover:text-ink-2">
                        {section.title}
                      </span>
                      <span className="tnum shrink-0 font-mono text-[10px] text-ink-3">
                        {String(section.subsections.length).padStart(2, "0")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Install */}
        <section
          id="install"
          className="scroll-mt-16 bg-carbon text-carbon-text lg:flex lg:min-h-screen lg:flex-col lg:justify-center"
        >
          <div className="shell py-20 lg:py-0">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <h2 className="heading text-[32px] text-carbon-text sm:text-[40px]">
                  {dict.installSection.title}
                </h2>
                <p className="measure mt-4 text-[15px] leading-7 text-carbon-text/65">
                  {dict.installSection.lead}
                </p>
                <p className="measure mt-6 font-mono text-[10.5px] leading-4 text-carbon-text/65">
                  {dict.installSection.note}
                </p>
              </div>

              <div className="lg:col-span-7">
                <div className="border border-carbon-rule">
                  <div className="flex items-center justify-between gap-3 border-b border-carbon-rule px-4 py-2.5">
                    <span className="font-mono text-[10.5px] text-carbon-text/65">postbuild</span>
                    <button
                      type="button"
                      onClick={copyInstall}
                      className="rounded-[3px] border border-carbon-rule px-2.5 py-1 font-mono text-[10.5px] text-carbon-text/70 transition-colors duration-150 hover:text-carbon-text active:scale-[0.98]"
                    >
                      {installCopied ? dict.hero.copiedLabel : dict.hero.copyLabel}
                    </button>
                  </div>
                  <div className="px-4 py-6 sm:px-6 sm:py-8">
                    <code className="block font-mono text-[20px] leading-tight text-carbon-text sm:text-[28px]">
                      <span className="text-carbon-text/55">$ </span>
                      <HighlightedCode code={dict.installSection.command} language="bash" />
                    </code>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <a
                    href="https://github.com/Woffluon/unpeek"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-[4px] bg-carbon-text px-4 py-2.5 text-[13px] font-medium leading-none text-ink transition-opacity duration-150 hover:opacity-85"
                  >
                    {dict.installSection.starCta}
                  </a>
                  <a
                    href="https://www.npmjs.com/package/unpeek"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-[4px] border border-carbon-rule px-4 py-2.5 text-[13px] leading-none text-carbon-text/80 transition-colors duration-150 hover:text-carbon-text"
                  >
                    {dict.installSection.npmCta}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}
