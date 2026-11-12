import Link from "next/link";
import type { Dictionary, Locale } from "@/content/i18n";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";

interface SiteHeaderProps {
  locale: Locale;
  version: string;
  nav: Dictionary["nav"];
}

const linkClass =
  "text-[13px] leading-none text-ink-2 transition-colors duration-150 hover:text-ink";

export function SiteHeader({ locale, version, nav }: SiteHeaderProps) {
  const homeHref = locale === "tr" ? "/tr/" : "/";
  const docsHref = locale === "tr" ? "/tr/docs/" : "/docs/";

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper">
      <div className="shell flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <Link href={homeHref} className="group flex items-center gap-2.5" aria-label="unpeek home">
            <BrandMark className="text-ink" />
            <span className="text-[17px] font-medium leading-none tracking-[-0.02em]">
              unpeek
            </span>
          </Link>
          <span className="hidden font-mono text-[11px] leading-none text-ink-3 sm:inline">
            {version}
          </span>
        </div>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          <Link href={`${homeHref}#parser`} className={linkClass}>
            {nav.parser}
          </Link>
          <Link href={`${homeHref}#lab`} className={linkClass}>
            {nav.lab}
          </Link>
          <Link href={`${homeHref}#specs`} className={linkClass}>
            {nav.specs}
          </Link>
          <Link href={docsHref} className={linkClass}>
            {nav.docs}
          </Link>
        </nav>

        <div className="flex items-center gap-2.5">
          <details className="relative md:hidden">
            <summary className="flex h-8 cursor-pointer list-none items-center rounded-[4px] border border-rule px-2.5 font-mono text-[11px] text-ink-2 [&::-webkit-details-marker]:hidden">
              {locale === "tr" ? "menü" : "menu"}
            </summary>
            <div className="absolute right-0 top-10 flex w-44 flex-col gap-1 border border-rule bg-paper p-2 shadow-[0_8px_24px_rgba(17,17,17,0.08)]">
              <Link href={`${homeHref}#parser`} className="px-2 py-2 text-[13px] text-ink-2">
                {nav.parser}
              </Link>
              <Link href={`${homeHref}#lab`} className="px-2 py-2 text-[13px] text-ink-2">
                {nav.lab}
              </Link>
              <Link href={`${homeHref}#specs`} className="px-2 py-2 text-[13px] text-ink-2">
                {nav.specs}
              </Link>
              <Link href={docsHref} className="px-2 py-2 text-[13px] text-ink-2">
                {nav.docs}
              </Link>
              <a
                href="https://github.com/Woffluon/unpeek"
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-2 text-[13px] text-ink-2"
              >
                {nav.github}
              </a>
            </div>
          </details>

          <LanguageSwitcher locale={locale} />

          <a
            href="https://github.com/Woffluon/unpeek"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center rounded-[4px] border border-rule px-3 py-1.5 text-[13px] leading-none text-ink transition-colors duration-150 hover:bg-paper-2 sm:inline-flex"
          >
            {nav.github}
          </a>
        </div>
      </div>
    </header>
  );
}
