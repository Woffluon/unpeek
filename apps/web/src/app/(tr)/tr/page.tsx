import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { HomePageView } from "@/components/home-page-view";

export const metadata: Metadata = buildPageMetadata({
  locale: "tr",
  enRoute: "/",
  absoluteTitle: "unpeek | Frame bütçeli istemci tarafı JS koruması",
  description:
    "unpeek bir paketi yeniden yazmadan önce 3 katmanlı çağrı grafiğini okur. 60fps döngüleri ve render gövdeleri kaynak halini korur; soğuk işleyiciler O(1) kasaya ve isteğe bağlı --aggressive Micro-VM'e girer.",
});

export default function TurkishHomePage() {
  return <HomePageView locale="tr" />;
}
