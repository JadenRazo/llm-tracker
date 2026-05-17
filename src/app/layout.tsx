import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: {
    default: "claude-tracker",
    template: "%s · claude-tracker",
  },
  description:
    "A public read-only dashboard tracking the Claude ecosystem: new models, Claude Code CLI releases, SDKs, docs, status, and curated tips.",
  metadataBase: new URL("https://claude.raizhost.com"),
  openGraph: {
    title: "claude-tracker",
    description:
      "One-stop shop for staying current with the Claude ecosystem — models, CLI, SDKs, docs, status, tips.",
    url: "https://claude.raizhost.com",
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
