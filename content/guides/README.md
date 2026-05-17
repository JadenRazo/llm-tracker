# Guides — authoring format

Each `.md` file in this directory is rendered at `/guides/{filename-without-ext}`.

## Frontmatter

```yaml
---
title: "Full guide title"
summary: "One-paragraph hook for the index page."
category: "Setup"              # e.g. "Setup", "Integration", "Migration"
date: "2025-01-20"             # ISO date
tags: ["claude-code", "mcp"]   # optional
---
```

## Body

Plain Markdown. Longer than tips — expect multiple headings, diagrams
(via code blocks), and copy-paste commands. Include a "Verify" section at the
end whenever possible so readers can confirm they did it right.

## Publishing

Commit, redeploy. No database, no admin UI.
