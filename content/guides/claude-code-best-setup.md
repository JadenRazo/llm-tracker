---
title: The best Claude Code setup for 2026
summary: A pragmatic starting point — what to install, what to configure, and what to skip. Every recommendation is sourced and pinned to the currently-verified CLI version.
category: Setup
date: "2026-04-24"
tags: ["claude-code", "settings", "skills", "mcp", "hooks"]
verifiedAgainstCli: "2.1.119"
verifiedAt: "2026-04-24"
---

This is not a feature tour. It's the shortest path from empty directory to a Claude Code setup that behaves well for real work.

## 1. Install the native binary, not npm

The `@anthropic-ai/claude-code` npm package is [deprecated](https://github.com/anthropics/claude-code). Install one of:

```sh
curl -fsSL https://claude.ai/install.sh | bash
# or
brew install anthropic/tap/claude-code
# or
winget install Anthropic.ClaudeCode
```

The native installer has smaller footprint, faster startup, and auto-update via `claude update`. It also picks up OS-level sandboxing improvements that the Node-based distribution can't.

## 2. Authenticate once

```sh
claude auth login
```

Follow the browser prompt. If your org uses SSO, use `--sso`. For a console-only API key, use `--console` to skip the browser entirely.

## 3. Create your user-scope `CLAUDE.md` and `settings.json`

Two files, both at `~/.claude/`, set the tone for every session on the machine:

- `~/.claude/CLAUDE.md` — persistent instructions Claude reads into every session. Keep it under ~200 lines (anything past ~200 gets truncated by the auto-memory index). Include: your role, your language/stack preferences, non-obvious project conventions, and anti-patterns you don't want repeated.
- `~/.claude/settings.json` — machine-wide defaults. Minimum worth setting:

```json
{
  "$schema": "https://code.claude.com/schema/settings.json",
  "model": "claude-opus-4-7",
  "effortLevel": "medium",
  "editorMode": "vim",
  "permissions": {
    "defaultMode": "ask"
  },
  "includeGitInstructions": true,
  "autoUpdatesChannel": "stable"
}
```

See the [full settings reference](https://code.claude.com/docs/en/settings) for every available key. Resist the urge to opt into every toggle on day one — most defaults are well-chosen.

## 4. Per-project `.claude/` layout

At the root of each repo:

```
.claude/
├── CLAUDE.md              # project-specific conventions, domain rules
├── settings.json          # project overrides (allowed tools, MCP servers)
├── settings.local.json    # your personal overrides, gitignored
├── skills/                # canonical form for repeatable workflows
│   └── <name>/SKILL.md
├── agents/                # project-scoped subagent definitions
│   └── <name>.md
├── .mcp.json              # project-scope MCP servers (committed to VCS)
└── hooks/                 # shell scripts referenced by settings.json hooks
```

Commit `CLAUDE.md`, `settings.json`, `skills/`, `agents/`, `.mcp.json`, and `hooks/`. Gitignore `settings.local.json`. This gives every contributor the same Claude-aware defaults without leaking personal API keys.

## 5. Skills over commands

As of Claude Code 2.1, **[custom commands have been merged into Skills](https://code.claude.com/docs/en/skills)**. The old `.claude/commands/*.md` form still works, but `.claude/skills/<name>/SKILL.md` is the canonical shape going forward. Skills support frontmatter (description, allowed tools, model override), auto-invocation based on user message patterns, and bundling additional assets next to the skill body.

Start with one skill per recurring workflow: `lint`, `run-tests`, `deploy-preview`, etc. Name them for what they *do*, not what they *are* ("run-migrations", not "migration-runner-helper").

## 6. A sensible hook or two

The [31 documented hook events](https://code.claude.com/docs/en/hooks) are powerful but easy to over-subscribe. Start with two:

- `PostToolUse` matcher `Edit|Write` → run your formatter and linter. Fails fast before edits pile up.
- `SessionStart` → print a 5-line statusline that shows git branch, staged-change count, running tests. Cheap situational awareness.

Skip everything else until you have a concrete reason to add it.

## 7. MCP: less is more

Add MCP servers one at a time. Every server you add increases the tool surface Claude sees at session start, which eats context budget. Four servers worth the cost for most developers:

- **Filesystem** (`npx -y @modelcontextprotocol/server-filesystem`) — sandboxed read/write.
- **Git** (`uvx mcp-server-git`) — structured git access, faster than shelling out.
- **Fetch** (`uvx mcp-server-fetch`) — web page retrieval with content conversion.
- One workflow-specific: your DB, your issue tracker, your monitoring. Pick the one where Claude saving you 10 context-switches per week justifies the install cost.

Enable with `claude mcp add --scope project <name> <command>`. See [the MCP docs](https://code.claude.com/docs/en/mcp) for OAuth, scopes, and precedence.

## 8. Statusline

`/statusline` lets Claude render one line of live context under the prompt: model, cost-so-far, git branch, test status. Worth 30 seconds to configure — it pays back every session by surfacing the state you'd otherwise `ctrl-z` to check.

## 9. What to *skip* on day one

- Subagents beyond the three built-ins (`Explore`, `Plan`, `general-purpose`). Custom subagents are real leverage — just not on day one.
- The full hook catalog. You don't need `WorktreeCreate` + `ConfigChange` + `TaskCompleted` until you're running agent teams.
- `/ultrareview` and `/ultraplan` — fantastic, but they're cloud-run and bill separately. Use them deliberately, not habitually.
- Every MCP server on the awesome list. Adding them is cheap; paying the context tax every session is not.

## Verification

```sh
claude --version   # expect 2.1.x
claude doctor      # runs a self-check and flags misconfiguration
```

If `doctor` flags something, fix that before trying anything fancier.
