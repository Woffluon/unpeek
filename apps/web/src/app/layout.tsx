import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const montreal = localFont({
  src: [
    { path: "../fonts/neue-montreal-book.woff2", weight: "400", style: "normal" },
    { path: "../fonts/neue-montreal-medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/neue-montreal-bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-montreal",
  display: "swap",
  preload: true,
});

const diatype = localFont({
  src: [{ path: "../fonts/diatype-bold.woff2", weight: "700", style: "normal" }],
  variable: "--font-diatype",
  display: "swap",
  preload: true,
});

const ioskeley = localFont({
  src: [
    { path: "../fonts/ioskeley-mono-regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ioskeley-mono-medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-ioskeley",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "unpeek | Client-side JS protection with a frame budget",
    template: "%s | unpeek",
  },
  description:
    "unpeek reads the call graph before it rewrites a bundle. Hot-path functions stay untouched, so protection costs under 2% CPU and under 15% gzip.",
  applicationName: "unpeek",
  authors: [{ name: "unpeek" }],
  keywords: [
    "javascript obfuscation",
    "call graph",
    "hot path",
    "source map vault",
    "next.js protection",
    "client bundle security",
  ],
  openGraph: {
    title: "unpeek | 0% tax on the hot path",
    description:
      "Call-graph aware JavaScript protection. Hot functions stay untouched. Cold paths go to the vault.",
    type: "website",
    siteName: "unpeek",
  },
  twitter: {
    card: "summary_large_image",
    title: "unpeek | 0% tax on the hot path",
    description:
      "Call-graph aware JavaScript protection. Hot functions stay untouched. Cold paths go to the vault.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${montreal.variable} ${diatype.variable} ${ioskeley.variable}`}>
      <body className="min-h-screen antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
