import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "unpeek — Zero-Config Client-Side JS Protection & Anti-Reverse-Engineering",
  description:
    "Protect Next.js, Vite, Webpack, and Vanilla JS client bundles with <2% CPU overhead, <15% Gzip delta, and automatic hot-path call-graph exemption.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="bg-[#09090b] text-zinc-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}
