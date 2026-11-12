import type { Metadata } from "next";
import "@/app/globals.css";
import { fontVariables } from "@/lib/fonts";
import { buildLayoutMetadata } from "@/lib/seo";

export const metadata: Metadata = buildLayoutMetadata("tr");

export default function TurkishRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className={fontVariables}>
      <body className="min-h-screen antialiased">
        <a href="#main" className="skip-link">
          İçeriğe atla
        </a>
        {children}
      </body>
    </html>
  );
}
