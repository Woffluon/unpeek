"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/content/i18n";

function resolveLocalizedHref(pathname: string | null, target: Locale): string {
  const raw = pathname || "/";
  const isTr = raw === "/tr" || raw === "/tr/" || raw.startsWith("/tr/");
  const enBase = isTr ? (raw.length <= 4 ? "/" : raw.slice(3)) : raw;
  const normalized = enBase === "/" ? "/" : enBase.endsWith("/") ? enBase : `${enBase}/`;

  if (target === "en") return normalized;
  return normalized === "/" ? "/tr/" : `/tr${normalized}`;
}

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const enHref = resolveLocalizedHref(pathname, "en");
  const trHref = resolveLocalizedHref(pathname, "tr");

  return (
    <div
      role="group"
      aria-label="Language"
      className="flex items-center rounded-[4px] border border-rule p-0.5"
    >
      <Link
        href={enHref}
        hrefLang="en"
        aria-current={locale === "en" ? "page" : undefined}
        className={`rounded-[2px] px-2 py-1 font-mono text-[11px] leading-none transition-colors duration-150 ${
          locale === "en" ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"
        }`}
      >
        EN
      </Link>
      <Link
        href={trHref}
        hrefLang="tr"
        aria-current={locale === "tr" ? "page" : undefined}
        className={`rounded-[2px] px-2 py-1 font-mono text-[11px] leading-none transition-colors duration-150 ${
          locale === "tr" ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"
        }`}
      >
        TR
      </Link>
    </div>
  );
}
