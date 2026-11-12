import localFont from "next/font/local";

export const montreal = localFont({
  src: [
    { path: "../fonts/neue-montreal-book.woff2", weight: "400", style: "normal" },
    { path: "../fonts/neue-montreal-medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/neue-montreal-bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-montreal",
  display: "swap",
  preload: true,
});

export const diatype = localFont({
  src: [{ path: "../fonts/diatype-bold.woff2", weight: "700", style: "normal" }],
  variable: "--font-diatype",
  display: "swap",
  preload: true,
});

export const ioskeley = localFont({
  src: [
    { path: "../fonts/ioskeley-mono-regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ioskeley-mono-medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-ioskeley",
  display: "swap",
  preload: true,
});

export const fontVariables = `${montreal.variable} ${diatype.variable} ${ioskeley.variable}`;
