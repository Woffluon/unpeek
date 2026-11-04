"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import type { Dictionary, DocSection } from "@/content/i18n";

interface DocsReaderProps {
  dict: Dictionary;
}

export function DocsReader({ dict }: DocsReaderProps) {
  const sections = dict.docsSections;
  const [selectedId, setSelectedId] = useState<string>(sections[0]?.id ?? "");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const articles = Array.from(document.querySelectorAll<HTMLElement>("[data-doc-section]"));
    if (articles.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.getAttribute("data-doc-section");
        if (id) setSelectedId(id);
      },
      { rootMargin: "-96px 0px -65% 0px", threshold: 0 }
    );

    articles.forEach((article) => observer.observe(article));
    return () => observer.disconnect();
  }, [dict]);

  const handleCopy = (code: string, key: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(code);
    setCopiedKey(key);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1600);
  };

  const currentIndex = Math.max(
    0,
    sections.findIndex((section) => section.id === selectedId)
  );
  const prev = currentIndex > 0 ? sections[currentIndex - 1] : null;
  const next = currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

  const navItemClass = (active: boolean) =>
    `flex items-baseline gap-3 border-l-2 py-2 pl-3 text-[13px] transition-colors duration-150 ${
      active ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"
    }`;

  return (
    <div className="grid grid-cols-1 gap-0 border-t border-rule lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="border-b border-rule py-6 lg:border-b-0 lg:border-r lg:pr-6">
        <details className="lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between border border-rule px-3 py-2 font-mono text-[11px] uppercase tracking-[0.04em] text-ink-2 [&::-webkit-details-marker]:hidden">
            {dict.docsHeader.sidebarTitle}
            <span className="tnum text-ink-3">
              {String(sections.length).padStart(2, "0")}
            </span>
          </summary>

          <nav aria-label={dict.docsHeader.sidebarTitle} className="mt-3 space-y-0.5">
            {sections.map((section: DocSection) => (
              <a
                key={section.id}
                href={`#doc-${section.id}`}
                onClick={() => setSelectedId(section.id)}
                aria-current={selectedId === section.id ? "true" : undefined}
                className={navItemClass(selectedId === section.id)}
              >
                <span className="tnum font-mono text-[10.5px] text-ink-3">{section.number}</span>
                <span className="leading-snug">{section.title}</span>
              </a>
            ))}
          </nav>
        </details>

        <nav
          aria-label={dict.docsHeader.sidebarTitle}
          className="sticky top-24 hidden space-y-3 lg:block"
        >
          {sections.map((section: DocSection) => (
            <div key={section.id}>
              <a
                href={`#doc-${section.id}`}
                onClick={() => setSelectedId(section.id)}
                aria-current={selectedId === section.id ? "true" : undefined}
                className={navItemClass(selectedId === section.id)}
              >
                <span className="tnum font-mono text-[10.5px] text-ink-3">{section.number}</span>
                <span className="leading-snug">{section.title}</span>
              </a>

              {selectedId === section.id && section.subsections.length > 0 && (
                <ol className="mt-1 mb-1 space-y-0.5 border-l border-rule pl-6">
                  {section.subsections.map((sub, index) => (
                    <li key={index}>
                      <a
                        href={`#doc-${section.id}-${index}`}
                        className="block py-1 text-[11.5px] leading-5 text-ink-3 transition-colors duration-150 hover:text-ink"
                      >
                        {sub.title}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <div className="lg:px-8 xl:px-10">
        {sections.map((section: DocSection) => (
          <article
            key={section.id}
            id={`doc-${section.id}`}
            data-doc-section={section.id}
            className="scroll-mt-24 border-b border-rule py-10 last:border-b-0"
          >
            <header className="measure">
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-3">
                <span className="tnum">{section.number}</span>
                <span>/</span>
                <span>#{section.id}</span>
              </div>
              <h2 className="heading mt-3 text-[30px] text-ink sm:text-[34px]">{section.title}</h2>
              <p className="mt-3 text-[15px] leading-7 text-ink-2">{section.summary}</p>
            </header>

            <div className="mt-8 space-y-9">
              {section.subsections.map((sub, subIdx) => {
                const subId = `${section.id}-${subIdx}`;
                return (
                  <div key={subId} id={`doc-${subId}`} className="scroll-mt-24 space-y-3">
                    <h3 className="text-[18px] font-medium leading-snug tracking-[-0.01em] text-ink">
                      {sub.title}
                    </h3>

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
                            <span className="mt-[9px] h-1 w-1 shrink-0 bg-signal" aria-hidden="true" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {sub.codeBlocks?.map((cb, cIdx) => {
                      const blockKey = `${section.id}-${subIdx}-${cIdx}`;
                      const isCopied = copiedKey === blockKey;
                      return (
                        <div key={blockKey} className="mt-4 overflow-hidden border border-rule">
                          <div className="flex items-center justify-between gap-3 border-b border-carbon-rule bg-carbon px-3 py-2">
                            <span className="font-mono text-[11px] text-carbon-text/60">
                              {cb.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(cb.code, blockKey)}
                              className="rounded-[3px] px-2 py-1 font-mono text-[10.5px] text-carbon-text/70 transition-colors duration-150 hover:bg-carbon-2 hover:text-carbon-text active:scale-[0.98]"
                            >
                              {isCopied ? dict.hero.copiedLabel : dict.hero.copyLabel}
                            </button>
                          </div>
                          <pre className="code-scroll overflow-x-auto bg-carbon p-4 text-[11.5px] leading-6 text-carbon-text/90">
                            <code>{cb.code}</code>
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </article>
        ))}

        <nav
          aria-label={dict.docsHeader.sidebarTitle}
          className="grid grid-cols-1 gap-0 sm:grid-cols-2"
        >
          {prev ? (
            <Link
              href={`#doc-${prev.id}`}
              onClick={() => setSelectedId(prev.id)}
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
              href={`#doc-${next.id}`}
              onClick={() => setSelectedId(next.id)}
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
  );
}
