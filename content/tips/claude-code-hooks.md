---
title: "Lint on save with Claude Code hooks"
summary: "Wire a PostToolUse hook to run your linter automatically after every Edit/Write."
category: "Claude Code"
date: "2025-01-15"
tags: ["hooks", "lint", "settings.json"]
---

Claude Code runs shell commands at well-defined lifecycle points via the `hooks`
config in `~/.claude/settings.json`. The highest-leverage one is `PostToolUse` —
it fires after any tool completes, so you can run a formatter or linter the
moment a file is touched.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "cd \"$CLAUDE_PROJECT_DIR\" && npx --yes eslint --fix \"$CLAUDE_FILE_PATH\" 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

Three things to notice:

- `matcher` is a regex over tool names — this fires only on file-mutating tools.
- The `|| true` means lint failures don't block the tool output (hooks that exit
  non-zero are surfaced as errors to Claude).
- `$CLAUDE_FILE_PATH` and `$CLAUDE_PROJECT_DIR` are injected by the harness.

Project-scoped variant: put the same JSON in `.claude/settings.json` at the repo
root and it applies only inside that repo.
