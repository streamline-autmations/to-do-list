import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const ui = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const code = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  title: "TaskHub",
  description: "Private shared task list.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1214" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${code.variable}`}>
      <body>{children}</body>
    </html>
  );
}
