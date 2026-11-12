import Link from "next/link";
import { DICTIONARY, type DocSection, type Locale } from "@/content/i18n";
import { LAST_MODIFIED_ISO } from "@/lib/seo";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HighlightedCode } from "@/components/syntax-highlight";
import { CopyButton } from "@/components/copy-button";
import { JsonLd, docArticleJsonLd } from "@/components/json-ld";

export function DocArticleView({
  locale,
  section,
}: {
  locale: Locale;
  section: DocSection;
}) {
  const dict = DICTIONARY[locale];
  const sections = dict.docsSections;
  const currentIndex = sections.findIndex((item) => item.id === section.id);
  const prev = currentIndex > 0 ? sections[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

  const homeHref = locale === "tr" ? "/tr/" : "/";
  const docsBase = locale === "tr" ? "/tr/docs" : "/docs";

  const navItemClass = (active: boolean) =>
    `flex items-baseline gap-3 border-l-2 py-2 pl-3 text-[13px] transition-colors duration-150 ${
      active ? "border-ink text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink"
    }`;

  return (
    <div className="flex min-h-screen flex-col">
      <JsonLd data={docArticleJsonLd(locale, section)} />
      <SiteHeader locale={locale} version={dict.meta.version} nav={dict.nav} />

      <main id="main" className="flex-1">
        <div className="shell py-10 lg:py-14">
          <nav
            aria-label="Breadcrumb"
            className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link href={homeHref} className="transition-colors duration-150 hover:text-ink">
                {dict.docsHeader.backToHomeLabel}
              </Link>
              <span aria-hidden="true">/</span>
              <Link href={`${docsBase}/`} className="transition-colors duration-150 hover:text-ink">
                {dict.docsHeader.onPageLabel}
              </Link>
              <span aria-hidden="true">/</span>
              <span className="text-ink">{section.id}</span>
            </div>
            <div className="flex items-center gap-4">
              <time dateTime={LAST_MODIFIED_ISO}>{LAST_MODIFIED_ISO}</time>
              <span className="tnum">{dict.meta.version}</span>
            </div>
          </nav>

          <header className="mt-8 max-w-[70ch]">
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-3">
              <span className="tnum">{section.number}</span>
              <span>/</span>
              <span>{section.id}</span>
            </div>
            <h1 className="display mt-3 text-[36px] text-ink sm:text-[50px]">{section.title}</h1>
            <p className="mt-4 text-[16px] leading-7 text-ink-2">{section.summary}</p>
          </header>

          <div className="mt-10 grid grid-cols-1 gap-0 border-t border-rule lg:grid-cols-[248px_minmax(0,1fr)]">
            <aside className="border-b border-rule py-6 lg:border-b-0 lg:border-r lg:pr-6">
              <details className="lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between border border-rule px-3 py-2 font-mono text-[11px] uppercase tracking-[0.04em] text-ink-2 [&::-webkit-details-marker]:hidden">
                  {dict.docsHeader.sidebarTitle}
                  <span className="tnum text-ink-3">
                    {String(sections.length).padStart(2, "0")}
                  </span>
                </summary>

                <nav aria-label={dict.docsHeader.sidebarTitle} className="mt-3 space-y-0.5">
                  {sections.map((item) => (
                    <Link
                      key={item.id}
                      href={`${docsBase}/${item.id}/`}
                      aria-current={item.id === section.id ? "page" : undefined}
                      className={navItemClass(item.id === section.id)}
                    >
                      <span className="tnum font-mono text-[10.5px] text-ink-3">
                        {item.number}
                      </span>
                      <span className="leading-snug">{item.title}</span>
                    </Link>
                  ))}
                </nav>
              </details>

              <nav
                aria-label={dict.docsHeader.sidebarTitle}
                className="sticky top-24 hidden space-y-2 lg:block"
              >
                {sections.map((item) => {
                  const isActive = item.id === section.id;
                  return (
                    <div key={item.id}>
                      <Link
                        href={`${docsBase}/${item.id}/`}
                        aria-current={isActive ? "page" : undefined}
                        className={navItemClass(isActive)}
                      >
                        <span className="tnum font-mono text-[10.5px] text-ink-3">
                          {item.number}
                        </span>
                        <span className="leading-snug">{item.title}</span>
                      </Link>

                      {isActive && item.subsections.length > 0 && (
                        <ol className="mt-1 mb-1 space-y-0.5 border-l border-rule pl-6">
                          {item.subsections.map((sub, index) => (
                            <li key={sub.title}>
                              <a
                                href={`#sub-${index}`}
                                className="block py-1 text-[11.5px] leading-5 text-ink-3 transition-colors duration-150 hover:text-ink"
                              >
                                {sub.title}
                              </a>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </nav>
            </aside>

            <div className="lg:px-8 xl:px-10">
              <article className="py-10">
                <div className="space-y-10">
                  {section.subsections.map((sub, subIdx) => (
                    <section key={sub.title} id={`sub-${subIdx}`} className="scroll-mt-24 space-y-3">
                      <h2 className="text-[20px] font-medium leading-snug tracking-[-0.015em] text-ink">
                        {sub.title}
                      </h2>

                      <div className="measure space-y-3">
                        {sub.body.map((paragraph, pIdx) => (
                          <p key={pIdx} className="text-[15px] leading-7 text-ink-2">
                            {paragraph}
                          </p>
                        ))}
                      </div>

                      {sub.bullets && sub.bullets.length > 0 && (
                        <ul className="measure space-y-2.5">
                          {sub.bullets.map((bullet, bIdx) => (
                            <li key={bIdx} className="flex gap-3 text-[14px] leading-6 text-ink-2">
                              <span
                                className="mt-[9px] h-1 w-1 shrink-0 bg-signal"
                                aria-hidden="true"
                              />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {sub.codeBlocks?.map((cb, cIdx) => (
                        <div
                          key={`${subIdx}-${cIdx}`}
                          className="mt-4 overflow-hidden border border-rule"
                        >
                          <div className="flex items-center justify-between gap-3 border-b border-carbon-rule bg-carbon px-3 py-2">
                            <span className="font-mono text-[11px] text-carbon-text/60">
                              {cb.label}
                            </span>
                            <CopyButton
                              text={cb.code}
                              copyLabel={dict.hero.copyLabel}
                              copiedLabel={dict.hero.copiedLabel}
                              className="rounded-[3px] px-2 py-1 font-mono text-[10.5px] text-carbon-text/70 transition-colors duration-150 hover:bg-carbon-2 hover:text-carbon-text active:scale-[0.98]"
                            />
                          </div>
                          <pre className="code-scroll overflow-x-auto bg-carbon p-4 text-[11.5px] leading-6 text-carbon-text/90">
                            <HighlightedCode code={cb.code} language={cb.language} />
                          </pre>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </article>

              <nav
                aria-label={dict.docsHeader.sidebarTitle}
                className="grid grid-cols-1 gap-0 border-t border-rule sm:grid-cols-2"
              >
                {prev ? (
                  <Link
                    href={`${docsBase}/${prev.id}/`}
                    className="group border-b border-rule py-4 sm:border-b-0 sm:border-r sm:pr-6"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                      {dict.docsHeader.previousLabel}
                    </span>
                    <span className="mt-1 block text-[13px] leading-5 text-ink-2 transition-colors duration-150 group-hover:text-ink">
                      {prev.title}
                    </span>
                  </Link>
                ) : (
                  <span className="hidden sm:block" />
                )}

                {next ? (
                  <Link
                    href={`${docsBase}/${next.id}/`}
                    className="group border-b border-rule py-4 sm:border-b-0 sm:pl-6 sm:text-right"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                      {dict.docsHeader.nextLabel}
                    </span>
                    <span className="mt-1 block text-[13px] leading-5 text-ink-2 transition-colors duration-150 group-hover:text-ink">
                      {next.title}
                    </span>
                  </Link>
                ) : null}
              </nav>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter locale={locale} version={dict.meta.version} footer={dict.footer} />
    </div>
  );
}
