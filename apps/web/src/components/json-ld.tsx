import { DICTIONARY, type DocSection, type Locale } from "@/content/i18n";
import {
  GITHUB_URL,
  LAST_MODIFIED_ISO,
  NPM_URL,
  SITE_URL,
  absoluteUrl,
  localizedRoute,
} from "@/lib/seo";

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

const PUBLISHER_ORG = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: "Woffluon",
  url: GITHUB_URL,
  sameAs: [GITHUB_URL, NPM_URL],
};

export function homeJsonLd(locale: Locale): Record<string, unknown> {
  const isTr = locale === "tr";
  const version = DICTIONARY[locale].meta.version.replace(/^v/, "");
  const pageUrl = absoluteUrl(localizedRoute(locale, "/"));

  return {
    "@context": "https://schema.org",
    "@graph": [
      PUBLISHER_ORG,
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: "unpeek",
        inLanguage: ["en", "tr"],
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        name: "unpeek",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Cross-platform (Node.js >= 18)",
        softwareVersion: version,
        license: "https://opensource.org/licenses/MIT",
        url: pageUrl,
        codeRepository: GITHUB_URL,
        downloadUrl: NPM_URL,
        inLanguage: locale,
        description: isTr
          ? "Next.js, Vite, Webpack ve Rollup için çağrı grafiği farkında istemci tarafı JavaScript koruma aracı."
          : "Zero-config, call-graph-aware client-side JavaScript protection and anti-reverse-engineering toolkit for Next.js, Vite, Webpack, and Rollup.",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        author: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };
}

export function docsHubJsonLd(locale: Locale): Record<string, unknown> {
  const isTr = locale === "tr";
  const pageUrl = absoluteUrl(localizedRoute(locale, "/docs/"));
  const homeUrl = absoluteUrl(localizedRoute(locale, "/"));

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: isTr ? "unpeek Dokümantasyon" : "unpeek Documentation",
        url: pageUrl,
        inLanguage: locale,
        dateModified: LAST_MODIFIED_ISO,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: PUBLISHER_ORG,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: isTr ? "Ana Sayfa" : "Home",
            item: homeUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: isTr ? "Dokümantasyon" : "Documentation",
            item: pageUrl,
          },
        ],
      },
    ],
  };
}

export function docArticleJsonLd(locale: Locale, section: DocSection): Record<string, unknown> {
  const isTr = locale === "tr";
  const homeUrl = absoluteUrl(localizedRoute(locale, "/"));
  const docsUrl = absoluteUrl(localizedRoute(locale, "/docs/"));
  const articleUrl = absoluteUrl(localizedRoute(locale, `/docs/${section.id}/`));

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        headline: section.title,
        description: section.summary,
        url: articleUrl,
        mainEntityOfPage: articleUrl,
        inLanguage: locale,
        dateModified: LAST_MODIFIED_ISO,
        author: PUBLISHER_ORG,
        publisher: PUBLISHER_ORG,
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: isTr ? "Ana Sayfa" : "Home",
            item: homeUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: isTr ? "Dokümantasyon" : "Documentation",
            item: docsUrl,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: section.title,
            item: articleUrl,
          },
        ],
      },
    ],
  };
}
