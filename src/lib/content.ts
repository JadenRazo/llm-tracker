// Filesystem-backed reader for curated markdown content (tips, guides).
//
// Files live under /content/{tips,guides}/*.md. Frontmatter is parsed with
// gray-matter. README.md files in each directory are skipped — they document
// the frontmatter format for future editors.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { DEFAULT_PROVIDER, providerSchema, type Provider } from "@/lib/providers";

const CONTENT_ROOT = path.join(process.cwd(), "content");

export interface ContentFrontmatter {
  title: string;
  summary?: string;
  category?: string;
  date?: string;
  tags?: string[];
  /** Claude Code CLI semver the author last verified this content against, e.g. "2.1.119". */
  verifiedAgainstCli?: string;
  /** ISO date the content was last verified. */
  verifiedAt?: string;
  /** Owning LLM provider. Optional in frontmatter — files without it (every
   *  existing guide/tip) resolve to "claude". */
  provider: Provider;
}

/** Coerce a raw frontmatter `provider` value to a known provider, defaulting
 *  to "claude" so legacy content without the field still parses. */
function resolveProvider(raw: unknown): Provider {
  const parsed = providerSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PROVIDER;
}

export interface ContentItem {
  slug: string;
  frontmatter: ContentFrontmatter;
  /** Raw markdown body (frontmatter stripped). */
  body: string;
  /** Computed reading-time label, e.g. "3 min read". Derived from body word count. */
  readingTime: string;
}

function computeReadingTime(body: string): string {
  const words = body.split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

// Content is filesystem-static between deploys; cache once per process.
const listCache = new Map<"tips" | "guides", ContentItem[]>();
const oneCache = new Map<string, ContentItem | null>();

function readDir(kind: "tips" | "guides"): ContentItem[] {
  const dir = path.join(CONTENT_ROOT, kind);
  if (!fs.existsSync(dir)) return [];

  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");

  const items: ContentItem[] = entries.map((file) => {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const parsed = matter(raw);
    const slug = file.replace(/\.md$/, "");
    const fm = parsed.data as Partial<ContentFrontmatter>;
    return {
      slug,
      frontmatter: {
        title: fm.title ?? slug,
        summary: fm.summary,
        category: fm.category,
        date: fm.date,
        tags: fm.tags,
        provider: resolveProvider((fm as { provider?: unknown }).provider),
      },
      body: parsed.content,
      readingTime: computeReadingTime(parsed.content),
    };
  });

  return items.sort((a, b) => {
    const ad = a.frontmatter.date ?? "";
    const bd = b.frontmatter.date ?? "";
    return bd.localeCompare(ad);
  });
}

export function listTips(): ContentItem[] {
  let cached = listCache.get("tips");
  if (!cached) {
    cached = readDir("tips");
    listCache.set("tips", cached);
  }
  return cached;
}

export function listGuides(): ContentItem[] {
  let cached = listCache.get("guides");
  if (!cached) {
    cached = readDir("guides");
    listCache.set("guides", cached);
  }
  return cached;
}

function getOne(kind: "tips" | "guides", slug: string): ContentItem | null {
  const cacheKey = `${kind}:${slug}`;
  if (oneCache.has(cacheKey)) return oneCache.get(cacheKey) ?? null;

  const file = path.join(CONTENT_ROOT, kind, `${slug}.md`);
  if (!fs.existsSync(file)) {
    oneCache.set(cacheKey, null);
    return null;
  }
  const raw = fs.readFileSync(file, "utf8");
  const parsed = matter(raw);
  const fm = parsed.data as Partial<ContentFrontmatter>;
  const item: ContentItem = {
    slug,
    frontmatter: {
      title: fm.title ?? slug,
      summary: fm.summary,
      category: fm.category,
      date: fm.date,
      tags: fm.tags,
      verifiedAgainstCli: fm.verifiedAgainstCli,
      verifiedAt: fm.verifiedAt,
      provider: resolveProvider((fm as { provider?: unknown }).provider),
    },
    body: parsed.content,
    readingTime: computeReadingTime(parsed.content),
  };
  oneCache.set(cacheKey, item);
  return item;
}

export function getTip(slug: string): ContentItem | null {
  return getOne("tips", slug);
}

export function getGuide(slug: string): ContentItem | null {
  return getOne("guides", slug);
}

/**
 * Which providers have at least one tip / guide. The header uses this to hide
 * sections that would open onto "No tips yet": all curated MDX is Claude-only,
 * so the nav previously offered Tips and Guides for OpenAI and Gemini and both
 * led to an empty page. Offering a section is a promise; this keeps it honest
 * without deleting the sections for the provider that does have content.
 */
export function providersWithContent(kind: "tips" | "guides"): Provider[] {
  const items = kind === "tips" ? listTips() : listGuides();
  return [...new Set(items.map((i) => i.frontmatter.provider))];
}
