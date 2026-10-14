"use client";

import Link from "next/link";
import { taskGuidance } from "@/lib/frontier/presentation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { comparisonHref, type FrontierModel } from "@/lib/frontier-models";


export function TaskGuide({ models, asOf }: { models: FrontierModel[]; asOf: string }) {
  const tasks = taskGuidance(models, asOf);
  const [active, setActive] = useState(0);
  const task = tasks[active];
  return (
    <section className="task-guide" aria-labelledby="task-guide-heading">
      <div className="task-guide-intro"><p className="intro-kicker">A starting point</p><h2 id="task-guide-heading">What are you working on?</h2><p>Choose a task to see what matters.</p></div>
      <div className="min-w-0">
        <div className="task-buttons" role="group" aria-label="Choose a task">
          {tasks.map((item, i) => <button key={item.label} type="button" aria-pressed={i === active} onClick={() => setActive(i)}>{item.label}</button>)}
        </div>
        <div className="task-answer" aria-live="polite" aria-atomic="true"><h3>{task.title}</h3><p>{task.body}</p><Link href={comparisonHref(task.ids, models)}>Compare for this task <ArrowRight size={16} aria-hidden /></Link></div>
      </div>
    </section>
  );
}
