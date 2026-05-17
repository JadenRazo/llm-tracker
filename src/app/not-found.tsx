// Root not-found boundary. Required so `notFound()` (unknown `/[provider]`
// segments, missing or cross-provider guide/tip slugs) renders with a real
// 404 status instead of falling back to Next's default 200-status shell.

import Link from "next/link";
import { Compass } from "lucide-react";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <Container>
      <div className="py-12">
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="That route doesn't exist. It may have moved, or the provider isn't one we track."
          action={
            <Link
              href="/"
              className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-ui-sm font-medium text-[var(--color-highlight)] transition-colors hover:border-[var(--color-ring)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              Back to the tracker
            </Link>
          }
        />
      </div>
    </Container>
  );
}
