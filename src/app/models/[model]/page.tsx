import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { modelPrice } from "@/lib/frontier-models";
import { getFrontierData } from "@/lib/frontier/read";
import { verificationLabel } from "@/lib/frontier/presentation";
import { getProviderMeta, getProviderStyle } from "@/lib/provider-meta";
import { FrontierSourceNote } from "@/components/frontier/source-note";
import { ModelBenchmarks } from "@/components/benchmarks/model-benchmarks";
import { LABS, catalogPrice, officialModelPage, readCatalogModel, type CatalogModel } from "@/lib/model-directory";
import { capabilityLabel, formatContext, formatTrackedDate, trueCapabilities } from "@/lib/model-catalog";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ model: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = (await params).model;
  const data = await getFrontierData(id);
  const model = data.available.find((m) => m.id === id);
  if (model) return { title: `${model.name}: strengths & tradeoffs`, description: model.summary, alternates: { canonical: `/models/${model.id}` }, openGraph: { title: `${model.name}: strengths & tradeoffs`, description: model.summary, url: `/models/${model.id}` } };
  const catalog = await catalogModel(id);
  if (catalog.model) {
    const description = `${catalog.model.displayName} (${catalog.model.id}) in the tracked ${LABS[catalog.model.provider]} catalog: context window, output limit and documented capabilities.`;
    return { title: `${catalog.model.displayName}: tracked model`, description, alternates: { canonical: `/models/${catalog.model.id}` }, openGraph: { title: `${catalog.model.displayName}: tracked model`, description, url: `/models/${catalog.model.id}` } };
  }
  return data.unavailable || catalog.unavailable ? { title: "Model data temporarily unavailable", robots: { index: false } } : { title: "Model not found", robots: { index: false } };
}

// One catalog read per request, shared by the metadata and the page.
const catalogModel = cache((id: string) => readCatalogModel(id));

/**
 * A tracked model that is not the provider's verified pick. Catalog facts are
 * recorded when the model is first listed and are labelled as such: they are
 * not the re-verified profile the picks get.
 */
function CatalogProfile({ model, pick }: { model: CatalogModel; pick: { id: string; name: string } | undefined }) {
  const lab = LABS[model.provider], provider = getProviderMeta(model.provider).label;
  const tracked = formatTrackedDate(model.firstSeenAt);
  const capabilities = trueCapabilities(model.capabilities).filter((key) => key !== "documented").map(capabilityLabel);
  const input = catalogPrice(model.pricingIn), output = catalogPrice(model.pricingOut);
  const official = officialModelPage(model.provider, model.id);
  const specs: [string, string][] = [
    ["Model ID", model.id],
    ["Context window", formatContext(model.contextWindow)],
    ["Maximum output", formatContext(model.maxOutput)],
    ["Documented capabilities", capabilities.length ? capabilities.join(", ") : "None reported"],
    ["First tracked", tracked ? `${tracked} UTC` : "Not reported"],
  ];
  return <article className="frontier-page provider-scope" style={getProviderStyle(model.provider)} data-catalog-model={model.id}>
    <Link href={`/${model.provider}/models`} className="frontier-back">← {provider} model catalog</Link>
    <header className="frontier-intro"><p className="frontier-lab"><span className="provider-dot" aria-hidden />{lab} · Tracked model</p><h1>{model.displayName}</h1><p>Listed in {lab}’s API documentation{tracked ? ` and tracked here since ${tracked}` : ""}. It is in the catalog; it is not the tracker’s verified pick for {provider}.</p></header>
    <div className="profile-grid"><section><p className="intro-kicker">What this page shows</p><h2>Catalog facts, recorded once.</h2><p>The tracker reads each provider’s model list every two hours and records a model’s limits and capabilities when it first appears. These facts are not re-verified afterwards, so check the official page before relying on them.</p>{pick && pick.id !== model.id && <p>For a profile that is re-verified against official sources every two hours, see <Link href={`/models/${pick.id}`}>{pick.name}</Link>, the current {provider} pick.</p>}</section><section className="profile-specs"><h2>At a glance</h2><dl>{specs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section></div>
    {input && output && <section className="profile-pricing"><div><p className="intro-kicker">Standard API pricing, as first recorded</p><h2>${input} input <span>/ ${output} output</span></h2><p>USD per million tokens{tracked ? ` · Recorded ${tracked}` : ""}</p></div><p>Recorded from the provider’s model page when this model was first tracked. Later price changes are not picked up here. Caching, batch and other service tiers have separate rates.</p></section>}
    <ModelBenchmarks model={{ id: model.id, name: model.displayName, provider: model.provider }} />
    <section className="profile-sources"><h2>Check the evidence</h2><p>The official page is the authority for current limits and prices.</p><div><a href={official.url}>{official.label}<ArrowUpRight size={15} aria-hidden /></a><Link href={`/${model.provider}/models`}>Browse the tracked {provider} catalog <ArrowRight size={15} aria-hidden /></Link></div></section>
  </article>;
}

export default async function ModelProfile({ params }: Props) {
  const id = (await params).model;
  const data = await getFrontierData(id);
  const model = data.available.find((m) => m.id === id);
  if (!model) {
    // Not a verified pick. Any other tracked model still gets its catalog page.
    const catalog = await catalogModel(id);
    if (catalog.model) return <CatalogProfile model={catalog.model} pick={data.current.find((m) => m.provider === catalog.model!.provider && m.freshness !== "fallback")} />;
    if (data.unavailable || catalog.unavailable) return <div className="frontier-page"><h1>Model data temporarily unavailable</h1><p>We could not look up {id}. Please try again when the tracker reconnects.</p><Link href="/compare">Compare available profiles</Link></div>;
    notFound();
  }
  const asOf = new Date().toISOString().slice(0, 10);
  const price = modelPrice(model, asOf);
  return <article className="frontier-page provider-scope" style={getProviderStyle(model.provider)}>
    <Link href="/" className="frontier-back">← All frontier models</Link>
    <header className="frontier-intro"><p className="frontier-lab"><span className="provider-dot" aria-hidden />{model.lab} · Frontier profile</p><h1>{model.name}</h1><p>{model.summary}</p><Link href="/compare" className="frontier-button">Compare the picks from each lab <ArrowRight size={18} aria-hidden /></Link></header>
    <div className="profile-grid"><section><p className="intro-kicker">Consider it for</p><h2>{model.focus}</h2><p>{model.why}</p><h3>The tradeoff</h3><p>{model.tradeoff}</p><p className="profile-editorial">This guidance follows the documented capabilities, not test results. Independent benchmark results are listed below.</p></section><section className="profile-specs"><h2>At a glance</h2><dl>{[["Inputs", model.inputs], ["Context budget", model.context], ["Maximum output", model.output], ["Reasoning", model.reasoning], ["API access", model.access]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section></div>
    <section className="profile-pricing"><div><p className="intro-kicker">Standard API pricing</p><h2>${price.input} input <span>/ ${price.output} output</span></h2><p>USD per million tokens · Sources checked {verificationLabel(model.verifiedAt)}</p></div><p>{model.price.note} Rates follow the published schedule. Chat subscription prices are separate.</p></section>
    <ModelBenchmarks model={{ id: model.id, name: model.name, provider: model.provider }} />
    <section className="profile-sources"><h2>Check the evidence</h2><p>Provider documentation, verified {verificationLabel(model.verifiedAt)}.</p><div>{model.sources.map((source) => <a key={source.url} href={source.url}>{source.label}<ArrowUpRight size={15} aria-hidden /></a>)}<Link href={`/${model.provider}/models`}>Browse the tracked {getProviderMeta(model.provider).label} catalog <ArrowRight size={15} aria-hidden /></Link></div></section>
    <FrontierSourceNote models={[model]} />
  </article>;
}
