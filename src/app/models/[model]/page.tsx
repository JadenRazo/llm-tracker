import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { comparisonHref, FRONTIER_MODELS, FRONTIER_REVIEW_LABEL, frontierModel, modelPrice } from "@/lib/frontier-models";
import { getProviderMeta } from "@/lib/provider-meta";
import { FrontierSourceNote } from "@/components/frontier/source-note";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ model: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const model = frontierModel((await params).model);
  return model ? { title: `${model.name}: strengths & tradeoffs`, description: model.summary, alternates: { canonical: `/models/${model.id}` }, openGraph: { title: `${model.name}: strengths & tradeoffs`, description: model.summary, url: `/models/${model.id}` } } : { title: "Model not found" };
}

export default async function ModelProfile({ params }: Props) {
  const model = frontierModel((await params).model);
  if (!model) notFound();
  const asOf = new Date().toISOString().slice(0, 10);
  const price = modelPrice(model, asOf);
  return <article className="frontier-page" style={{ ["--provider-accent" as string]: getProviderMeta(model.provider).accentVar }}>
    <Link href="/" className="frontier-back">← All frontier models</Link>
    <header className="frontier-intro"><p className="frontier-lab"><span className="provider-dot" aria-hidden />{model.lab} · Frontier profile</p><h1>{model.name}</h1><p>{model.summary}</p><Link href="/compare" className="frontier-button">Compare all three <ArrowRight size={18} aria-hidden /></Link></header>
    <div className="profile-grid"><section><p className="intro-kicker">Consider it for</p><h2>{model.focus}</h2><p>{model.why}</p><h3>The tradeoff</h3><p>{model.tradeoff}</p><p className="profile-editorial">Task fit is our interpretation of provider documentation, not an independent benchmark result.</p></section><section className="profile-specs"><h2>At a glance</h2><dl>{[["Inputs", model.inputs], ["Context budget", model.context], ["Maximum output", model.output], ["Reasoning", model.reasoning], ["API access", model.access]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section></div>
    <section className="profile-pricing"><div><p className="intro-kicker">Standard API pricing</p><h2>${price.input} input <span>/ ${price.output} output</span></h2><p>USD per million tokens · Sources checked {FRONTIER_REVIEW_LABEL}</p></div><p>{model.price.note} Rates follow the published schedule. Chat subscription prices are separate.</p></section>
    <section className="profile-compare"><h2>How does it compare?</h2><div>{FRONTIER_MODELS.filter((other) => other.id !== model.id).map((other) => <Link key={other.id} href={comparisonHref([model.id, other.id])}><span>{model.name}<small>vs</small>{other.name}</span><ArrowRight size={20} aria-hidden /></Link>)}</div></section>
    <section className="profile-sources"><h2>Check the evidence</h2><p>Provider documentation, reviewed {FRONTIER_REVIEW_LABEL}.</p><div>{model.sources.map((source) => <a key={source.url} href={source.url}>{source.label}<ArrowUpRight size={15} aria-hidden /></a>)}<Link href={`/${model.provider}/models`}>Browse the tracked {getProviderMeta(model.provider).label} catalog <ArrowRight size={15} aria-hidden /></Link></div></section>
    <FrontierSourceNote asOf={asOf} />
  </article>;
}
