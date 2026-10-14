import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FRONTIER_MODELS, modelPrice } from "@/lib/frontier-models";
import { getProviderMeta } from "@/lib/provider-meta";

export function FrontierModelCards({ asOf }: { asOf: string }) {
  return (
    <div className="frontier-cards">
      {FRONTIER_MODELS.map((model) => (
        <article className="frontier-card" key={model.id} style={{ ["--provider-accent" as string]: getProviderMeta(model.provider).accentVar }}>
          <div className="frontier-lab"><span className="provider-dot" aria-hidden />{model.lab}</div>
          <h3><Link href={`/models/${model.id}`}>{model.name}<ArrowUpRight size={20} aria-hidden /></Link></h3>
          <p className="frontier-focus">{model.focus}</p>
          <p className="frontier-summary">{model.summary}</p>
          <dl className="frontier-card-specs">
            <div><dt>Context</dt><dd>{model.context}</dd></div>
            <div><dt>Base API / 1M tokens</dt><dd>${modelPrice(model, asOf).input} in · ${modelPrice(model, asOf).output} out</dd></div>
          </dl>
          <p className="frontier-price-note">{model.price.cardNote}</p>
          <Link href={`/models/${model.id}`} className="frontier-card-link">Strengths & tradeoffs <ArrowRight size={17} aria-hidden /></Link>
        </article>
      ))}
    </div>
  );
}
