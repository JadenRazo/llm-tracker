---
title: When /ultrareview earns its cloud-run cost
summary: It's not a replacement for code review. It's a second opinion on whether a branch is actually ready to ship.
category: Workflow
date: "2026-04-24"
tags: ["ultrareview", "review", "cloud-agents"]
verifiedAgainstCli: "2.1.119"
verifiedAt: "2026-04-24"
---

`/ultrareview` launches a multi-agent cloud review of the current branch. Different subagents look at security, correctness, style, and test coverage in parallel and reconcile their findings into a single punch list. Running it costs compute — your plan covers a few free runs, but over-using it in CI will surprise your billing.

**When it's worth it:**
- Before merging a branch that touches auth, payments, PII, or external APIs.
- Before a refactor PR where "does it still work" is load-bearing.
- When a teammate asks "is this good enough to ship?" and you want a second read in under five minutes.

**When it's not:**
- Bug fixes with tests. The tests *are* the review.
- Docs changes, renames, or bumps. There's nothing for the security or correctness agents to find.
- Exploratory branches you're not shipping. You can always run it later.

**Tip:** pair with `/ultraplan` for multi-week work — the planner produces the approach, you implement, the reviewer grades the result against the plan. Three agents, one cohesive loop.

If `/ultrareview` says "ship it," that's meaningful. If it flags an issue, fix it or document why it's wrong. The worst thing you can do is run it and ignore the output — then you're paying for second opinions you're not listening to.
