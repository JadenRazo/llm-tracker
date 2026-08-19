import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/header";
import { providersWithContent } from "@/lib/content";
import { Footer } from "@/components/footer";

// Canonical site origin. Env-overridable (e.g. preview deploys) with a safe
// production default — non-secret, so no boot validation needed.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://llm.raizhost.com";

// Self-hosted via next/font — fonts are downloaded at build time and served
// from /_next/static (immutable, same-origin), replacing the render-blocking
// Google Fonts CSS @import that added a third-party round-trip per page view.
// All three are variable fonts, so each ships as a single file.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
// Display headings only ever render at weight 600 (see the text-display-*
// utilities and the h1–h6 base rule in globals.css); italics are never used.
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: "600",
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "LLM Tracker — what's shipping across Claude, OpenAI & Gemini",
    template: "%s — LLM Tracker",
  },
  description:
    "A self-updating reference tracking what ships across Claude, OpenAI, and Gemini — CLI releases, models, docs, and status. Claude Code and Codex are the coding headliners; everything re-verifies itself as releases land.",
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": [
        { url: "/rss.xml", title: "LLM Tracker — all providers" },
        { url: "/claude/rss.xml", title: "LLM Tracker — Claude" },
        { url: "/openai/rss.xml", title: "LLM Tracker — OpenAI" },
        { url: "/gemini/rss.xml", title: "LLM Tracker — Gemini" },
      ],
    },
  },
  openGraph: {
    title: "LLM Tracker — what's shipping across Claude, OpenAI & Gemini",
    description:
      "Track Claude, OpenAI, and Gemini in one place — releases, CLIs, models, docs, and status, version-pinned and re-verified as they ship.",
    url: SITE_URL,
    siteName: "LLM Tracker",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1c1108",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} ${playfair.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        <Header
          contentAvailability={{
            tips: providersWithContent("tips"),
            guides: providersWithContent("guides"),
          }}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
