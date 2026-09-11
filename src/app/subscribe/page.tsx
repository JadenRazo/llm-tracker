import type { Metadata } from "next";
import { Rss } from "lucide-react";
import { FeedSubscription } from "@/components/feed-subscription";
import { PageHeader } from "@/components/ui/page-header";
import { PROVIDERS } from "@/lib/providers";
import { getProviderMeta } from "@/lib/provider-meta";

const feeds = [
  { id: "all", label: "All providers", path: "/rss.xml" },
  ...PROVIDERS.map((provider) => ({
    id: provider,
    label: getProviderMeta(provider).label,
    path: `/${provider}/rss.xml`,
  })),
];

export const metadata: Metadata = {
  title: "Subscribe to updates",
  description:
    "Follow Claude, OpenAI, and Gemini updates in your RSS reader. Choose a feed, copy its link, and add it to your reader.",
  alternates: {
    canonical: "/subscribe",
    types: {
      "application/rss+xml": feeds.map((feed) => ({
        url: feed.path,
        title: `LLM Tracker: ${feed.label}`,
      })),
    },
  },
};

// Instructions and public feed URLs are available even without a database.
export default function SubscribePage() {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://llm.raizhost.com";
  const choices = feeds.map((feed) => ({
    ...feed,
    url: new URL(feed.path, origin).href,
  }));

  return (
    <div className="subscription-page">
      <PageHeader
        icon={Rss}
        eyebrow="RSS subscriptions"
        title="Subscribe to updates"
        description="Releases, models, and status in your feed reader."
      />
      <div className="subscription-layout">
        <FeedSubscription feeds={choices} />
        <aside className="subscription-guide" aria-labelledby="rss-guide-title">
          <h2 id="rss-guide-title">New to RSS?</h2>
          <p>
            A feed reader brings updates from the sites you follow into one
            place.
          </p>
          <ol>
            <li>
              <strong>Choose your feed.</strong>
              <span>Follow all three providers, or pick just one.</span>
            </li>
            <li>
              <strong>Copy the feed link.</strong>
              <span>Use “Copy feed link” below your selected feed.</span>
            </li>
            <li>
              <strong>Add it to your reader.</strong>
              <span>
                Look for “Add feed” or “Follow website,” paste the link, and
                confirm.
              </span>
            </li>
          </ol>
          <p>
            Your reader will check for new entries. Copying a link is the setup
            step; you finish subscribing in your reader.
          </p>
          <p className="subscription-note">
            These feeds deliver updates through RSS. Email subscriptions are not
            currently offered.
          </p>
        </aside>
      </div>
    </div>
  );
}
