---
title: Fork a subagent instead of spawning fresh
summary: /fork inherits the parent session's full context and prompt cache. When the task benefits from everything you've already explained, a fork beats a fresh subagent.
category: Workflow
date: "2026-04-24"
tags: ["subagents", "fork", "prompt-cache"]
verifiedAgainstCli: "2.1.119"
verifiedAt: "2026-04-24"
---

Claude Code 2.1.117 introduced forked subagents. Enable with `CLAUDE_CODE_FORK_SUBAGENT=1`, then `/fork` spawns a subagent that:

1. Inherits the full parent conversation context.
2. Shares the parent's prompt cache (no cache-miss cost on the first turn).
3. Runs independently — its edits come back but its context doesn't pollute the parent.

**Use it when:** the subagent needs to know *why* you're doing what you're doing. E.g., you've spent 30 turns debugging a race condition, and now you want a subagent to write the fix without re-explaining the codebase.

**Don't use it when:** you want a clean context (use a fresh `general-purpose` agent). Or when the task is small enough that inheriting the whole parent is wasteful.

**The prompt-cache part is not cosmetic.** A fresh subagent on a long parent context pays the full input-token price on its first turn. A fork pays nothing new — the cache hit is ~90% cheaper and several times faster. For agent-heavy workflows, this compounds.

Check it's enabled with `/fork` at the prompt. If the command isn't available, the env var isn't set or the CLI is older than `2.1.117`.
