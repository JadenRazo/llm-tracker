import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

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
    default: "claude-tracker",
    template: "%s · claude-tracker",
  },
  description:
    "A public read-only dashboard tracking the Claude ecosystem: new models, Claude Code CLI releases, SDKs, docs, status, and curated tips.",
  metadataBase: new URL("https://llm.raizhost.com"),
  openGraph: {
    title: "claude-tracker",
    description:
      "One-stop shop for staying current with the Claude ecosystem — models, CLI, SDKs, docs, status, tips.",
    url: "https://llm.raizhost.com",
    siteName: "claude-tracker",
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
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
