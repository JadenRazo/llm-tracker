---
title: Hooks cookbook
summary: The 31 Claude Code hook events organized by family, with 5 real recipes for the ones you'll actually use. Skip the catalog, skim the recipes.
category: Workflow
date: "2026-04-24"
tags: ["hooks", "settings.json", "automation", "workflow"]
verifiedAgainstCli: "2.1.119"
verifiedAt: "2026-04-24"
---

Claude Code has ~31 hook events across 8 families ([official reference](https://code.claude.com/docs/en/hooks)). Most people need three. The catalog exists for rare edge cases; this guide covers what's load-bearing.

## The families, at a glance

- **Session lifecycle** — `SessionStart`, `SessionEnd`, `InstructionsLoaded`.
- **Per-turn** — `UserPromptSubmit`, `UserPromptExpansion`.
- **Agentic loop** — `PreToolUse`, `PostToolUse`, `PostToolBatch`, `PermissionRequest`, `PermissionDenied`, `PostToolUseFailure`, `Stop`, `StopFailure`.
- **Agent / task** — `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`.
- **Environment** — `CwdChanged`, `FileChanged`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`.
- **Notification** — `Notification`, `TeammateIdle`.
- **Compaction** — `PreCompact`, `PostCompact`.
- **MCP** — `Elicitation`, `ElicitationResult`.

Every event accepts five handler types: `command` (shell), `http` (remote endpoint), `mcp_tool`, `prompt` (LLM eval), and `agent` (subagent verifier). Each matcher also supports an `if` conditional.

## Recipe 1 — format + lint on every edit

Most common setup. Registers a `PostToolUse` hook that matches write-style tools:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "biome check --write $CLAUDE_CODE_TOOL_FILE_PATH 2>&1 || exit 2"
          }
        ]
      }
    ]
  }
}
```

Returning exit code `2` signals the hook failed — Claude sees the output and can auto-fix. Use for Prettier, Biome, Ruff, `go fmt`, etc. Scope this to the project (`.claude/settings.json`) not user-scope, so the formatter matches the repo's conventions.

## Recipe 2 — block dangerous commands at `PreToolUse`

Useful guardrail for shared machines or risky environments:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "if echo \"$CLAUDE_CODE_TOOL_COMMAND\" | grep -qE '\\brm -rf /|force-push.*main'; then echo BLOCKED; exit 2; fi"
          }
        ]
      }
    ]
  }
}
```

`exit 2` blocks the tool call and shows the output to Claude. Pair with the built-in permission system — don't use hooks as your only line of defense.

## Recipe 3 — session observability

Write a line to a log file on every session start and every tool call, for later analysis:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "date -u +%FT%TZ > ~/.claude/last-session.log" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "echo \"$CLAUDE_CODE_TOOL_NAME: $CLAUDE_CODE_TOOL_DURATION_MS ms\" >> ~/.claude/last-session.log" }] }]
  }
}
```

Pipe that log into your own dashboards. Cheap; stays out of the way.

## Recipe 4 — auto-verify before `Stop`

Stops Claude from declaring victory on broken code:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "npm run typecheck && npm run lint && npm run test -- --run" }
        ]
      }
    ]
  }
}
```

If any of the three fails with non-zero exit, Claude gets the error back and keeps working. This is the single highest-ROI hook most teams can add.

## Recipe 5 — `PermissionDenied` retry with context

When Claude asks for permission and you deny, give a reason via the retry mechanism:

```json
{
  "hooks": {
    "PermissionDenied": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "echo 'Denied because this command touches production. Use the staging equivalent instead.'; exit 2" }
        ]
      }
    ]
  }
}
```

Claude retries with your explanation as context. Way better than silently denying.

## Gotchas worth knowing

- **Hooks run in your shell**, not Claude's sandbox. They have the same access as whoever ran `claude`. Treat hook scripts as trusted code.
- **Stderr is noise, stdout is signal.** Claude sees stdout; stderr is logged but not fed back. Print your actionable message to stdout.
- **`exit 0`** = success, tool proceeds. **`exit 2`** = block, message goes to Claude. Any other non-zero exit is treated as a warning with no block.
- **Don't hook `PostToolUse` on `Read`.** The read tool fires constantly during exploration. Match only on write-side tools (`Edit`, `Write`, `NotebookEdit`, `Bash`).
- **MCP tools** match as `mcp__<server>__<tool>` in the matcher regex. Wrap in parentheses if you want to combine with built-in tools.

## When to reach for each family

- Shipping a feature → Recipe 1 + Recipe 4.
- Onboarding a new dev → Recipe 2.
- Building an agent team / running subagents → explore the `SubagentStart`/`SubagentStop` + `TaskCreated`/`TaskCompleted` pair for coordination hooks.
- Multi-worktree workflow → `WorktreeCreate`/`WorktreeRemove` for setup/teardown rituals.
- Running Claude unattended → `TeammateIdle` + `Notification` for offline-style session handoff.

The docs go deeper than this; read them when you need a specific payload field. But 80% of practical use is the five recipes above.
