---
title: "Claude Code: clean install and first-run setup (2025 version)"
summary: "Legacy guide from January 2025 — kept for reference. See the updated 2026 guide for the current approach."
category: "Setup"
date: "2025-01-20"
tags: ["claude-code", "mcp", "settings.json", "legacy"]
verifiedAgainstCli: "0.2.0"
verifiedAt: "2025-01-20"
---

> **This guide is from January 2025.** Claude Code has changed significantly since
> — the npm package is now deprecated, commands have merged into Skills, and
> settings.json gained ~50 new keys. **Read the
> [2026 best-setup guide](/guides/claude-code-best-setup) first.** This page is
> preserved for historical reference.

## Install

Claude Code ships as a global npm package. You need Node 18+ — but pin to 22 LTS
if you're setting up a fresh machine.

```bash
# via nvm (recommended)
nvm install 22
nvm use 22
npm install -g @anthropic-ai/claude-code

# verify
claude --version
```

Run `claude` once with no arguments. It'll prompt you to sign in via browser
OAuth, then drop you into an interactive session in the current directory.

## Tune settings.json

Settings live at `~/.claude/settings.json` (user-global) and `.claude/settings.json`
(per-project). The per-project file is checked into git and shared with your
team. A sensible starting point:

```json
{
  "theme": "dark",
  "editor": "nvim",
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(npm run *:*)"
    ]
  }
}
```

The `permissions.allow` list skips the per-command confirmation prompt for
read-only commands you trust — the pattern is `Tool(command-prefix:args)`. Keep
this list tight; it's the easiest way to turn an agent loose on your shell.

## Add an MCP server

MCP (Model Context Protocol) lets Claude Code talk to external tools. The
simplest useful one is the filesystem server — it exposes read/write operations
over a directory you designate.

```bash
claude mcp add filesystem --scope user -- npx -y @modelcontextprotocol/server-filesystem /path/to/project
```

This writes an entry to `~/.claude.json` (user scope) or `.mcp.json` (project
scope). Restart Claude Code for it to pick up the new server.

## Verify

After setup, run `/mcp` in an interactive session to list connected servers —
you should see `filesystem` marked "connected". If it says "failed", check the
command works standalone: `npx -y @modelcontextprotocol/server-filesystem /path`.

Test permissions by asking Claude to run `git status`. It should execute without
prompting. A different command like `rm` should still prompt — that's the
allow-list doing its job.
