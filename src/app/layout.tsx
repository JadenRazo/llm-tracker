import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

// Canonical site origin. Env-overridable (e.g. preview deploys) with a safe
// production default — non-secret, so no boot validation needed.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://llm.raizhost.com";

export const metadata: Metadata = {
  title: {
    default: "LLM Tracker — what's shipping across Claude, OpenAI & Gemini",
    template: "%s — LLM Tracker",
  },
  description:
    "A self-updating reference tracking what ships across Claude, OpenAI, and Gemini — CLI releases, models, docs, and status. Claude Code and Codex are the coding headliners; everything re-verifies itself as releases land.",
  metadataBase: new URL(SITE_URL),
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
    <html lang="en" suppressHydrationWarning>
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
