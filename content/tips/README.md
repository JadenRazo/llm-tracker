# Tips — authoring format

Each `.md` file in this directory is rendered at `/tips/{filename-without-ext}`.
Filename becomes the slug.

## Frontmatter

```yaml
---
title: "Short, specific title"
summary: "One-sentence hook (<= 160 chars)."
category: "Claude Code"         # e.g. "Claude Code", "SDK", "Models", "Hooks"
date: "2025-01-15"              # ISO date
tags: ["hooks", "lint"]         # optional
---
```

## Body

Plain Markdown. Code blocks with triple-backticks, standard headings, links.
Keep tips short — 100–300 words is the sweet spot. Longer material should be a
guide, not a tip.

## Publishing

1. Commit the file.
2. Redeploy (the list is a server component that reads the filesystem at request time).

That's it — no admin UI, no database involvement.
