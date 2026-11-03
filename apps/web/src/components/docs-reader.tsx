"use client";

import React, { useState } from "react";
import { Check, Copy, BookOpen, TerminalWindow } from "@phosphor-icons/react";
import type { Dictionary, DocSection } from "@/content/i18n";

interface DocsReaderProps {
  dict: Dictionary;
  activeSectionId?: string;
}

export function DocsReader({ dict, activeSectionId }: DocsReaderProps) {
  const [selectedId, setSelectedId] = useState<string>(
    activeSectionId || dict.docsSections[0]?.id || "quickstart"
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (code: string, key: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 border border-zinc-800 bg-[#0d0d10]">
      {/* Left Sidebar Navigation */}
      <aside className="lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-zinc-800 p-6 bg-[#09090b]">
        <div className="lg:sticky lg:top-24 space-y-6">
          <div className="flex items-center gap-2.5 pb-4 border-b border-zinc-800">
            <BookOpen size={18} weight="regular" className="text-emerald-400" />
            <span className="font-mono text-xs text-zinc-300 font-medium">
              {dict.docsHeader.sidebarTitle}
            </span>
          </div>

          <nav aria-label={dict.docsHeader.sidebarTitle} className="space-y-1">
            {dict.docsSections.map((sec: DocSection) => {
              const isCurrent = selectedId === sec.id;
              return (
                <a
                  key={sec.id}
                  href={`#doc-${sec.id}`}
                  onClick={() => setSelectedId(sec.id)}
                  className={`group flex items-start gap-3 px-3 py-2.5 text-left transition-colors border-l-2 ${
                    isCurrent
                      ? "border-emerald-500 bg-zinc-900/90 text-zinc-100"
                      : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40"
                  }`}
                >
                  <span
                    className={`font-mono text-xs mt-0.5 ${
                      isCurrent ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-400"
                    }`}
                  >
                    {sec.number}
                  </span>
                  <span className="text-sm font-medium leading-snug">{sec.title}</span>
                </a>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Documentation Content Stream */}
      <div className="lg:col-span-8 xl:col-span-9 divide-y divide-zinc-800">
        {dict.docsSections.map((section: DocSection) => (
          <article
            key={section.id}
            id={`doc-${section.id}`}
            onMouseEnter={() => setSelectedId(section.id)}
            className="p-6 md:p-10 lg:p-12 scroll-mt-20 space-y-8"
          >
            {/* Section Header */}
            <header className="space-y-3 border-b border-zinc-800/80 pb-6">
              <div className="flex items-center gap-2.5 font-mono text-xs text-emerald-400">
                <span>SECTION {section.number}</span>
                <span className="text-zinc-700">/</span>
                <span className="text-zinc-400">#{section.id}</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-100">
                {section.title}
              </h3>
              <p className="text-zinc-400 text-base leading-relaxed max-w-[68ch]">
                {section.summary}
              </p>
            </header>

            {/* Subsections */}
            <div className="space-y-10">
              {section.subsections.map((sub, subIdx) => (
                <div key={subIdx} className="space-y-4">
                  <h4 className="text-lg font-medium text-zinc-100 tracking-tight">
                    {sub.title}
                  </h4>

                  <div className="space-y-3">
                    {sub.body.map((paragraph, pIdx) => (
                      <p
                        key={pIdx}
                        className="text-sm md:text-base text-zinc-400 leading-relaxed max-w-[68ch]"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>

                  {sub.bullets && sub.bullets.length > 0 && (
                    <div className="grid grid-cols-1 gap-2.5 pt-2">
                      {sub.bullets.map((bullet, bIdx) => (
                        <div
                          key={bIdx}
                          className="flex items-start gap-3 p-3.5 border border-zinc-800/90 bg-[#09090b]"
                        >
                          <span className="font-mono text-xs text-emerald-400 mt-0.5 select-none">
                            0{bIdx + 1}
                          </span>
                          <p className="text-sm text-zinc-300 leading-relaxed">{bullet}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {sub.codeBlocks &&
                    sub.codeBlocks.map((cb, cIdx) => {
                      const blockKey = `${section.id}-${subIdx}-${cIdx}`;
                      const isCopied = copiedKey === blockKey;
                      return (
                        <div
                          key={blockKey}
                          className="border border-zinc-800 bg-[#09090b] overflow-hidden mt-4"
                        >
                          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-950">
                            <div className="flex items-center gap-2">
                              <TerminalWindow
                                size={15}
                                weight="regular"
                                className="text-emerald-400"
                              />
                              <span className="font-mono text-xs text-zinc-300">{cb.label}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopy(cb.code, blockKey)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono text-zinc-300 hover:text-zinc-100 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors active:scale-[0.98]"
                            >
                              {isCopied ? (
                                <>
                                  <Check size={13} weight="bold" className="text-emerald-400" />
                                  <span className="text-emerald-400">{dict.hero.copiedLabel}</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={13} weight="regular" />
                                  <span>{dict.hero.copyLabel}</span>
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="p-4 text-xs md:text-sm font-mono text-zinc-200 overflow-x-auto leading-relaxed">
                            <code>{cb.code}</code>
                          </pre>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
