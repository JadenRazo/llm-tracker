---
title: "Turn on extended thinking for hard debugging"
summary: "The Claude 4 family supports interleaved thinking — budget tokens for it when chasing a gnarly bug."
category: "Models"
date: "2025-02-03"
tags: ["claude-4", "thinking", "api"]
---

The Claude 4 series (Opus, Sonnet, Haiku) supports **interleaved thinking** — the
model generates a private reasoning trace between tool calls, not just before
its final response. For multi-step debugging where you're handing the model
several pieces of context in sequence (stack traces, logs, code reads), giving
it a thinking budget is the cheapest win you'll find.

Via the Messages API:

```python
response = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=8000,
    thinking={"type": "enabled", "budget_tokens": 4000},
    messages=[...],
)
```

In Claude Code, the `/think` slash-command toggles thinking mode on for the
current turn. For persistent use, set `"thinkingMode": "interleaved"` in
`settings.json`.

Rule of thumb: thinking tokens cost the same as output tokens but produce no
user-visible text. Budget enough for the model to actually reason (~2–8k for
non-trivial debugging), not so much you waste money on trivial tasks.
