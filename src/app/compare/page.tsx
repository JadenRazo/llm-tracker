import type { Metadata } from "next";
import Link from "next/link";
import { ModelComparison } from "@/components/frontier/model-comparison";
import { FrontierSourceNote } from "@/components/frontier/source-note";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare frontier AI models", description: "Compare Claude, OpenAI, and Gemini models: strengths, tradeoffs, input types, context limits, and API pricing with official sources.", alternates: { canonical: "/compare" }, openGraph: { title: "Compare frontier AI models", description: "Compare strengths, tradeoffs, capabilities, and API prices across Claude, OpenAI, and Gemini.", url: "/compare" } };

export default function ComparePage() {
  const asOf = new Date().toISOString().slice(0, 10);
  return <div className="frontier-page"><Link href="/" className="frontier-back">← All frontier models</Link><header className="frontier-intro"><p className="intro-kicker">The differences that matter</p><h1>Compare models.<br /><span>Choose for your work.</span></h1><p>Put any two—or all three—side by side. Your selection stays in the URL so you can bookmark or share it.</p></header><ModelComparison asOf={asOf} /><FrontierSourceNote asOf={asOf} /></div>;
}
