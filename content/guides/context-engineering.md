---
title: Context engineering for long Claude sessions
summary: Make the 200K-to-1M token window earn its keep. Layered CLAUDE.md, auto-memory, compaction tactics, and when to split a session before the context does it for you.
category: Workflow
date: "2026-04-24"
tags: ["context", "memory", "compaction", "claude-md", "plan-mode"]
verifiedAgainstCli: "2.1.119"
verifiedAt: "2026-04-24"
---

A 1M-token context window lets you be lazy. It shouldn't. Context-engineering is the discipline of putting exactly the right information in front of Claude and nothing else — the difference between a session that gets sharper over time and one that gets confused.

## The layering model

Claude reads instructions from four layers, in order of specificity:

1. **Global** — `~/.claude/CLAUDE.md`. Applies to every session on the machine. Lives across projects, across months.
2. **Project** — `./.claude/CLAUDE.md` + `./.claude/settings.json`. Domain rules, repo conventions, stakeholder context.
3. **Directory** — nested `CLAUDE.md` files as you `cd` deeper. Useful for monorepos where `packages/api/CLAUDE.md` and `packages/web/CLAUDE.md` differ.
4. **Session** — what you type, plus anything `/add-dir` pulls in.

**Rule of thumb:** the deeper the layer, the more specific the content. Global says "I prefer TypeScript"; project says "we use Drizzle, not Prisma"; directory says "no server components in this folder"; session says "fix the 500 on `/users/:id`".

Keep each layer short. The auto-memory system truncates entries past ~200 lines, so a bloated `CLAUDE.md` loses its trailing content silently. If you catch yourself writing a fifth paragraph, it probably belongs in a guide, not in memory.

## Auto-memory

Since Claude Code 2.1, persistent memory lives at `~/.claude/projects/<project-hash>/memory/`. The file-based system stores four kinds:

- **user** — who you are, how you like to work.
- **feedback** — corrections you've made to Claude's approach (with *why*).
- **project** — facts about in-flight work, deadlines, stakeholders.
- **reference** — pointers to where things live (Linear, Slack channels, dashboards).

Memory is written automatically when you correct Claude, confirm a non-obvious approach, or mention a stable fact. You don't maintain it by hand. But you *can* read it — `MEMORY.md` in that directory is the index.

**The killer move:** after a painful debugging session, skim the new memory entries. If something useful got saved, good. If something misleading got saved, correct it in the next turn — Claude will update the entry. Memory without review decays into folklore.

## Compaction strategy

When the context fills up, `/compact` writes a summary of the conversation so far and resumes with that summary + your pending task. Use it:

- **Proactively**, before a big refactor. A fresh window with a targeted prompt beats a half-full one with 50 turns of exploration noise.
- **After a plan is settled**, before execution. "We discussed the approach for 20 turns; execution only needs the 200-word plan."

Don't use `/compact` as a general "I'm confused" button — reread the conversation first. Compaction can't recover information that wasn't actually in the context.

Related: `/clear` starts over entirely. Useful for genuinely unrelated tasks. `/rewind` (alias `/checkpoint`, `/undo`) rolls back to a prior turn.

## When to split a session

Symptoms that you've outgrown the session:

- Claude references a file correctly but with a slightly wrong path (memory of the old structure is sticking).
- Two unrelated threads keep surfacing in each other's responses.
- You've asked "just summarize what we have so far" more than once.
- You hit `/compact` twice in the same hour.

Start a new session. If the work really does span multiple threads, consider `/fork` (requires `CLAUDE_CODE_FORK_SUBAGENT=1`) — it spawns a subagent that inherits the parent's full context and shares its prompt cache, so you pay no cache-miss cost.

## Plan mode as context hygiene

`/plan` forces Claude to produce a plan file before doing anything. Underused — most teams treat it as ceremony. The real benefit:

1. The planning step itself surfaces the assumptions you didn't realize you were making.
2. The plan file becomes the source of truth the implementer reads, not the 40 turns of conversation that led there.
3. After approval, execution is a separate agent run with a clean context and a precise brief.

Use plan mode for any task touching >3 files or any task that might split across sessions. The overhead (2-5 turns to lock the plan) pays itself back the first time you'd otherwise have had to re-explain context to a compacted session.

## Quick diagnostic

When a session feels off, run `/context`. It prints the currently-loaded context windows: global memory, project memory, CLAUDE.md files, attached directories, unread skills. If something surprising is loaded — a stale memory file, a directory you forgot you added — you've found your problem.

## What to not do

- **Don't paste a 3,000-line log.** Use `--add-dir` and let Claude request the parts it needs. Fewer tokens, sharper attention.
- **Don't put secrets in `CLAUDE.md`.** It gets committed, it gets read into every session, it goes places you don't expect.
- **Don't write `CLAUDE.md` entries that duplicate the system prompt.** Rules like "don't over-engineer" or "match file conventions" are already enforced upstream; restating them wastes tokens and signals noise.

Context engineering is mostly subtractive. The best sessions are the ones where you can list every file in context from memory.
