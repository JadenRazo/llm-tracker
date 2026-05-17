---
title: Skills superseded custom commands — here's what to change
summary: .claude/commands/*.md still works but .claude/skills/<name>/SKILL.md is the canonical form. Mechanical migration, real-world benefit.
category: Setup
date: "2026-04-24"
tags: ["skills", "commands", "migration"]
verifiedAgainstCli: "2.1.119"
verifiedAt: "2026-04-24"
---

As of Claude Code 2.1, custom slash commands have been merged into Skills. Old `.claude/commands/my-cmd.md` files still work — no breakage — but `.claude/skills/my-cmd/SKILL.md` is the shape going forward.

**Why the change matters:**

- **Auto-invocation.** A skill's `description` field can trigger Claude to reach for it without you typing `/my-cmd`. Good for workflows like "when the user asks about deployment, run the deploy skill."
- **Frontmatter controls.** Skills declare their allowed tools, model overrides, and (new in 2.1) preloaded context — no more global permission tweaks to constrain a single workflow.
- **Bundled assets.** A skill directory can hold helper scripts, templates, example outputs alongside `SKILL.md`. Commands were one file.

**Migration recipe** (five minutes per skill):

```sh
mkdir -p .claude/skills/my-cmd
git mv .claude/commands/my-cmd.md .claude/skills/my-cmd/SKILL.md
```

Then add a `description` field to the frontmatter — that's what drives auto-invocation:

```yaml
---
name: my-cmd
description: Use this skill when the user asks about deploying to staging or production. Handles the staged rollout dance for our Rails app.
---
```

**What to audit while you're there:**

- Does the skill need tool restrictions (`allowed-tools: [Read, Bash]`)? Safer defaults are free.
- Is the body more than ~100 lines? Split long skills into focused ones — Claude picks up shorter descriptions more reliably.
- Does it need its own model (`model: haiku` for a cheap routine task)? 2.1 lets you specify.

No rush to migrate if your commands are working. But if you're writing a new one, skip commands and write a skill from the start.
