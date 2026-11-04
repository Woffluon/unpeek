"use client";

import Link from "next/link";
import { DICTIONARY } from "@/content/i18n";
import { useLocale } from "@/lib/use-locale";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocsReader } from "@/components/docs-reader";

export default function DocsPage() {
  const [locale, setLocale] = useLocale();
  const dict = DICTIONARY[locale];

  const topicCount = dict.docsSections.reduce(
    (total, section) => total + section.subsections.length,
    0
  );
  const sampleCount = dict.docsSections.reduce(
    (total, section) =>
      total +
      section.subsections.reduce(
        (inner, sub) => inner + (sub.codeBlocks?.length ?? 0),
        0
      ),
    0
  );

  const stats = [
    { label: dict.docsHeader.stats.sections, value: dict.docsSections.length },
    { label: dict.docsHeader.stats.topics, value: topicCount },
    { label: dict.docsHeader.stats.samples, value: sampleCount },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader dict={dict} locale={locale} onLocaleChange={setLocale} />

      <main id="main" className="flex-1">
        <div className="shell py-10 lg:py-14">
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="transition-colors duration-150 hover:text-ink"
              >
                {dict.docsHeader.backToHomeLabel}
              </Link>
              <span aria-hidden="true">/</span>
              <span className="text-ink">{dict.docsHeader.onPageLabel}</span>
            </div>
            <span className="tnum">{dict.meta.version}</span>
          </div>

          <header className="mt-8 max-w-[70ch]">
            <h1 className="display text-[40px] text-ink sm:text-[56px]">
              {dict.docsHeader.title}
            </h1>
            <p className="mt-4 text-[16px] leading-7 text-ink-2">{dict.docsHeader.subtitle}</p>
          </header>

          <dl className="mt-9 grid grid-cols-3 border-t border-ink">
            {stats.map((stat, index) => (
              <div
                key={stat.label}
                className={`border-b border-rule py-3 ${
                  index === 0 ? "pr-4" : "border-l border-rule pl-4 sm:pl-6"
                }`}
              >
                <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                  {stat.label}
                </dt>
                <dd className="tnum mt-1 font-display text-[24px] leading-none tracking-[-0.03em] text-ink">
                  {String(stat.value).padStart(2, "0")}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-12">
            <DocsReader dict={dict} />
          </div>
        </div>
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}
