import type { Metadata } from "next";
import { DICTIONARY, type DocSection, type Locale } from "@/content/i18n";

export const SITE_URL = "https://woffluon.github.io/unpeek";
export const OG_IMAGE_URL = `${SITE_URL}/opengraph-image.png`;
export const GITHUB_URL = "https://github.com/Woffluon/unpeek";
export const NPM_URL = "https://www.npmjs.com/package/unpeek";
export const LAST_MODIFIED_ISO = "2026-11-12";

export function normalizeRoute(route: string): string {
  if (!route || route === "/") return "/";
  const withLeading = route.startsWith("/") ? route : `/${route}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

export function localizedRoute(locale: Locale, enRoute: string): string {
  const normalized = normalizeRoute(enRoute);
  if (locale === "en") return normalized;
  return normalized === "/" ? "/tr/" : `/tr${normalized}`;
}

export function absoluteUrl(route: string): string {
  const normalized = normalizeRoute(route);
  return normalized === "/" ? `${SITE_URL}/` : `${SITE_URL}${normalized}`;
}

export function buildLanguageAlternates(enRoute: string) {
  const normalized = normalizeRoute(enRoute);
  const enUrl = absoluteUrl(normalized);
  const trUrl = absoluteUrl(localizedRoute("tr", normalized));
  return {
    en: enUrl,
    tr: trUrl,
    "x-default": enUrl,
  };
}

export function getDocSlugs(): string[] {
  return DICTIONARY.en.docsSections.map((section) => section.id);
}

export function getDocSection(locale: Locale, slug: string): DocSection | undefined {
  return DICTIONARY[locale].docsSections.find((section) => section.id === slug);
}

export function buildLayoutMetadata(locale: Locale): Metadata {
  const isTr = locale === "tr";
  const defaultTitle = isTr
    ? "unpeek | Frame bütçeli istemci tarafı JS koruması"
    : "unpeek | Client-side JS protection with a frame budget";
  const description = isTr
    ? "unpeek paketi yeniden yazmadan önce çağrı grafiğini okur. Hot-path fonksiyonları dokunulmadan kalır; koruma %2'nin altında CPU ve %15'in altında gzip maliyeti sunar."
    : "unpeek reads the call graph before it rewrites a bundle. Hot-path functions stay untouched, so protection costs under 2% CPU and under 15% gzip.";
  const ogTitle = isTr ? "unpeek | Hot path üzerinde %0 vergi" : "unpeek | 0% tax on the hot path";
  const ogDescription = isTr
    ? "Çağrı grafiği farkında JavaScript koruması. Sıcak fonksiyonlar dokunulmaz, soğuk yollar kasaya girer."
    : "Call-graph aware JavaScript protection. Hot functions stay untouched. Cold paths go to the vault.";

  return {
    metadataBase: new URL(`${SITE_URL}/`),
    title: {
      default: defaultTitle,
      template: "%s | unpeek",
    },
    description,
    applicationName: "unpeek",
    authors: [{ name: "Woffluon", url: GITHUB_URL }],
    keywords: isTr
      ? [
          "javascript obfuscation",
          "çağrı grafiği koruması",
          "hot path",
          "source map kasası",
          "next.js güvenliği",
          "client bundle koruması",
        ]
      : [
          "javascript obfuscation",
          "call graph",
          "hot path",
          "source map vault",
          "next.js protection",
          "client bundle security",
        ],
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      type: "website",
      siteName: "unpeek",
      locale: isTr ? "tr_TR" : "en_US",
      alternateLocale: isTr ? ["en_US"] : ["tr_TR"],
      url: absoluteUrl(localizedRoute(locale, "/")),
      images: [
        {
          url: OG_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: "unpeek — Call-graph aware client-side JavaScript protection",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
      images: [OG_IMAGE_URL],
    },
  };
}

interface PageMetaOptions {
  locale: Locale;
  enRoute: string;
  title?: string;
  absoluteTitle?: string;
  description: string;
  type?: "website" | "article";
}

export function buildPageMetadata({
  locale,
  enRoute,
  title,
  absoluteTitle,
  description,
  type = "website",
}: PageMetaOptions): Metadata {
  const currentUrl = absoluteUrl(localizedRoute(locale, enRoute));
  const resolvedTitle = absoluteTitle ?? (title ? `${title} | unpeek` : "unpeek");

  return {
    title: absoluteTitle ? { absolute: absoluteTitle } : title,
    description,
    alternates: {
      canonical: currentUrl,
      languages: buildLanguageAlternates(enRoute),
    },
    openGraph: {
      title: resolvedTitle,
      description,
      url: currentUrl,
      type,
      siteName: "unpeek",
      locale: locale === "tr" ? "tr_TR" : "en_US",
      alternateLocale: locale === "tr" ? ["en_US"] : ["tr_TR"],
      images: [
        {
          url: OG_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: "unpeek — Call-graph aware client-side JavaScript protection",
        },
      ],
      ...(type === "article" ? { modifiedTime: LAST_MODIFIED_ISO } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedTitle,
      description,
      images: [OG_IMAGE_URL],
    },
  };
}
