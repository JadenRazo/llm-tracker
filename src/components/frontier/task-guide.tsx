"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { comparisonHref, FRONTIER_MODELS } from "@/lib/frontier-models";

const TASKS = [
  { label: "Code & agents", title: "Try the same real task in all three.", body: "All three target complex reasoning and coding. Astra offers OpenAI’s tool workflows; Fable targets long-running agents; Argon combines code work with broader media input. Your repository, tools, and tests are the useful tiebreaker.", ids: FRONTIER_MODELS.map((m) => m.id) },
  { label: "Audio & video", title: "Start with Gemini 4 Argon.", body: "Argon accepts audio and video directly. Astra and Fable accept text and images, so those workflows need transcription or frame extraction first. This is an input-capability advantage, not proof of better answers.", ids: ["gemini-4-argon", "gpt-6-astra"] },
  { label: "Research & documents", title: "Match the model to your material.", body: "All three can reason over long inputs. Compare their tools and input formats, then check whether the answer preserves evidence and cites the right passages. A larger context budget alone does not establish better recall or accuracy.", ids: FRONTIER_MODELS.map((m) => m.id) },
  { label: "Cost & speed", title: "Compare total work, not just token rates.", body: "Argon has the lowest listed standard text-token rates among these picks. But thinking, tools, retries, and service tiers affect the bill. We have no like-for-like latency measurements; test completion time on your own workload.", ids: FRONTIER_MODELS.map((m) => m.id) },
];

export function TaskGuide() {
  const [active, setActive] = useState(0);
  const task = TASKS[active];
  return (
    <section className="task-guide" aria-labelledby="task-guide-heading">
      <div className="task-guide-intro"><p className="intro-kicker">A starting point</p><h2 id="task-guide-heading">What are you working on?</h2><p>Choose a task to see what matters.</p></div>
      <div className="min-w-0">
        <div className="task-buttons" role="group" aria-label="Choose a task">
          {TASKS.map((item, i) => <button key={item.label} type="button" aria-pressed={i === active} onClick={() => setActive(i)}>{item.label}</button>)}
        </div>
        <div className="task-answer" aria-live="polite" aria-atomic="true"><h3>{task.title}</h3><p>{task.body}</p><Link href={comparisonHref(task.ids)}>Compare for this task <ArrowRight size={16} aria-hidden /></Link></div>
      </div>
    </section>
  );
}
