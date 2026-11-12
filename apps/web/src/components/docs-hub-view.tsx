import Link from "next/link";
import { DICTIONARY, type Locale } from "@/content/i18n";
import { LAST_MODIFIED_ISO } from "@/lib/seo";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { JsonLd, docsHubJsonLd } from "@/components/json-ld";

export function DocsHubView({ locale }: { locale: Locale }) {
  const dict = DICTIONARY[locale];
  const homeHref = locale === "tr" ? "/tr/" : "/";
  const docsBase = locale === "tr" ? "/tr/docs" : "/docs";

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
      <JsonLd data={docsHubJsonLd(locale)} />
      <SiteHeader locale={locale} version={dict.meta.version} nav={dict.nav} />

      <main id="main" className="flex-1">
        <div className="shell py-10 lg:py-14">
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
            <div className="flex items-center gap-2">
              <Link href={homeHref} className="transition-colors duration-150 hover:text-ink">
                {dict.docsHeader.backToHomeLabel}
              </Link>
              <span aria-hidden="true">/</span>
              <span className="text-ink">{dict.docsHeader.onPageLabel}</span>
            </div>
            <div className="flex items-center gap-4">
              <time dateTime={LAST_MODIFIED_ISO}>{LAST_MODIFIED_ISO}</time>
              <span className="tnum">{dict.meta.version}</span>
            </div>
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

          <section
            aria-label={dict.docsHeader.sidebarTitle}
            className="mt-12 grid grid-cols-1 border-t border-rule md:grid-cols-2"
          >
            {dict.docsSections.map((section, index) => (
              <article
                key={section.id}
                id={`doc-${section.id}`}
                className={`scroll-mt-24 border-b border-rule py-8 ${
                  index % 2 === 0 ? "md:border-r md:pr-8" : "md:pl-8"
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[10.5px] text-ink-3">
                  <span className="tnum">{section.number}</span>
                  <span>
                    {String(section.subsections.length).padStart(2, "0")}{" "}
                    {dict.docsHeader.stats.topics.toLowerCase()}
                  </span>
                </div>

                <h2 className="heading mt-3 text-[24px] text-ink">
                  <Link
                    href={`${docsBase}/${section.id}/`}
                    className="transition-colors duration-150 hover:text-signal"
                  >
                    {section.title}
                  </Link>
                </h2>

                <p className="mt-3 text-[14px] leading-6 text-ink-2">{section.summary}</p>

                <ul className="mt-4 space-y-1.5 border-t border-rule pt-4">
                  {section.subsections.map((sub, subIdx) => (
                    <li key={sub.title}>
                      <Link
                        href={`${docsBase}/${section.id}/#sub-${subIdx}`}
                        className="flex items-baseline gap-2 text-[13px] leading-5 text-ink-2 transition-colors duration-150 hover:text-ink"
                      >
                        <span className="font-mono text-[10px] text-ink-3">→</span>
                        <span>{sub.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="mt-5">
                  <Link
                    href={`${docsBase}/${section.id}/`}
                    className="inline-flex items-center gap-2 font-mono text-[11.5px] text-ink underline decoration-rule underline-offset-4 transition-colors duration-150 hover:text-signal"
                  >
                    {locale === "tr" ? "Bölümü oku" : "Read section"}
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </section>
        </div>
      </main>

      <SiteFooter locale={locale} version={dict.meta.version} footer={dict.footer} />
    </div>
  );
}
