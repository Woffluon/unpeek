"use client";

import Link from "next/link";
import type { Dictionary, Locale } from "@/content/i18n";
import { BrandMark } from "@/components/brand-mark";

interface SiteHeaderProps {
  dict: Dictionary;
  locale: Locale;
  onLocaleChange: (next: Locale) => void;
}

const linkClass =
  "text-[13px] leading-none text-ink-2 transition-colors duration-150 hover:text-ink";

export function SiteHeader({ dict, locale, onLocaleChange }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper">
      <div className="shell flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="unpeek home">
            <BrandMark className="text-ink" />
            <span className="text-[17px] font-medium leading-none tracking-[-0.02em]">
              unpeek
            </span>
          </Link>
          <span className="hidden font-mono text-[11px] leading-none text-ink-3 sm:inline">
            {dict.meta.version}
          </span>
        </div>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          <Link href="/#parser" className={linkClass}>
            {dict.nav.parser}
          </Link>
          <Link href="/#lab" className={linkClass}>
            {dict.nav.lab}
          </Link>
          <Link href="/#specs" className={linkClass}>
            {dict.nav.specs}
          </Link>
          <Link href="/docs" className={linkClass}>
            {dict.nav.docs}
          </Link>
        </nav>

        <div className="flex items-center gap-2.5">
          <details className="relative md:hidden">
            <summary className="flex h-8 cursor-pointer list-none items-center rounded-[4px] border border-rule px-2.5 font-mono text-[11px] text-ink-2 [&::-webkit-details-marker]:hidden">
              {locale === "tr" ? "menü" : "menu"}
            </summary>
            <div className="absolute right-0 top-10 flex w-44 flex-col gap-1 border border-rule bg-paper p-2 shadow-[0_8px_24px_rgba(17,17,17,0.08)]">
              <Link href="/#parser" className="px-2 py-2 text-[13px] text-ink-2">
                {dict.nav.parser}
              </Link>
              <Link href="/#lab" className="px-2 py-2 text-[13px] text-ink-2">
                {dict.nav.lab}
              </Link>
              <Link href="/#specs" className="px-2 py-2 text-[13px] text-ink-2">
                {dict.nav.specs}
              </Link>
              <Link href="/docs" className="px-2 py-2 text-[13px] text-ink-2">
                {dict.nav.docs}
              </Link>
              <a
                href="https://github.com/Woffluon/unpeek"
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-2 text-[13px] text-ink-2"
              >
                {dict.nav.github}
              </a>
            </div>
          </details>

          <div
            role="group"
            aria-label="Language"
            className="flex items-center rounded-[4px] border border-rule p-0.5"
          >
            <button
              type="button"
              onClick={() => onLocaleChange("en")}
              aria-pressed={locale === "en"}
              className={`rounded-[2px] px-2 py-1 font-mono text-[11px] leading-none transition-colors duration-150 ${
                locale === "en" ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => onLocaleChange("tr")}
              aria-pressed={locale === "tr"}
              className={`rounded-[2px] px-2 py-1 font-mono text-[11px] leading-none transition-colors duration-150 ${
                locale === "tr" ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"
              }`}
            >
              TR
            </button>
          </div>

          <a
            href="https://github.com/Woffluon/unpeek"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center rounded-[4px] border border-rule px-3 py-1.5 text-[13px] leading-none text-ink transition-colors duration-150 hover:bg-paper-2 sm:inline-flex"
          >
            {dict.nav.github}
          </a>
        </div>
      </div>
    </header>
  );
}
