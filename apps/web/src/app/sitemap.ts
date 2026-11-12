import type { MetadataRoute } from "next";
import { DICTIONARY } from "@/content/i18n";
import { LAST_MODIFIED_ISO, absoluteUrl, buildLanguageAlternates, localizedRoute } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(LAST_MODIFIED_ISO);
  const routes: Array<{
    enRoute: string;
    priority: number;
    changeFrequency: "weekly" | "monthly";
  }> = [
    { enRoute: "/", priority: 1.0, changeFrequency: "weekly" },
    { enRoute: "/docs/", priority: 0.9, changeFrequency: "weekly" },
    ...DICTIONARY.en.docsSections.map((section) => ({
      enRoute: `/docs/${section.id}/`,
      priority: 0.8,
      changeFrequency: "monthly" as const,
    })),
  ];

  return routes.flatMap(({ enRoute, priority, changeFrequency }) => {
    const alternates = { languages: buildLanguageAlternates(enRoute) };
    return [
      {
        url: absoluteUrl(enRoute),
        lastModified,
        changeFrequency,
        priority,
        alternates,
      },
      {
        url: absoluteUrl(localizedRoute("tr", enRoute)),
        lastModified,
        changeFrequency,
        priority: Number(Math.max(0.5, priority - 0.1).toFixed(1)),
        alternates,
      },
    ];
  });
}
