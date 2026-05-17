"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  Activity,
  BookOpen,
  Boxes,
  Lightbulb,
  Map,
  Menu,
  Package,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { PROVIDERS, type Provider } from "@/lib/providers";
import {
  providerFromPathname,
  swapProviderInPath,
} from "@/lib/provider-route";
import { getProviderMeta } from "@/lib/provider-meta";

interface NavItem {
  /** Path suffix appended to the active provider base (""=provider home). */
  suffix: string;
  label: string;
  icon: LucideIcon;
}

// Links are section-relative: rendered against whichever provider is active
// (Claude when on the cross-provider root). "" is the provider home.
const LINKS: NavItem[] = [
  { suffix: "", label: "Learn", icon: BookOpen },
  { suffix: "/models", label: "Models", icon: Boxes },
  { suffix: "/releases", label: "Releases", icon: Terminal },
  { suffix: "/tips", label: "Tips", icon: Lightbulb },
  { suffix: "/guides", label: "Guides", icon: Map },
  { suffix: "/changelog", label: "Changelog", icon: Package },
  { suffix: "/status", label: "Status", icon: Activity },
];

const FALLBACK_PROVIDER: Provider = "claude";

function navHref(provider: Provider, suffix: string): string {
  return `/${provider}${suffix}`;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Persistent provider switcher. Reflects the active provider derived from the
 * pathname; selecting one navigates to the equivalent page under that
 * provider (e.g. `/claude/releases` → `/openai/releases`). On the
 * cross-provider root nothing is marked current.
 */
function ProviderSwitcher({
  activeProvider,
  pathname,
  onNavigate,
  size = "default",
}: {
  activeProvider: Provider | null;
  pathname: string;
  onNavigate?: () => void;
  size?: "default" | "full";
}) {
  const router = useRouter();
  return (
    <div
      role="group"
      aria-label="Switch provider"
      className={clsx(
        "inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5",
        size === "full" && "w-full",
      )}
    >
      {PROVIDERS.map((p) => {
        const meta = getProviderMeta(p);
        const current = p === activeProvider;
        const target = swapProviderInPath(pathname, p);
        return (
          <button
            key={p}
            type="button"
            aria-current={current ? "true" : undefined}
            onClick={() => {
              onNavigate?.();
              router.push(target);
            }}
            style={{ ["--provider-accent" as string]: meta.accentVar }}
            className={clsx(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2.5 py-1 text-ui-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              current
                ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            <span
              className={clsx(
                "size-1.5 rounded-full",
                current
                  ? "bg-[var(--provider-accent)]"
                  : "bg-[var(--color-border)]",
              )}
              aria-hidden
            />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  const activeProvider = providerFromPathname(pathname);
  // Section links need a concrete base even on the cross-provider root.
  const linkProvider = activeProvider ?? FALLBACK_PROVIDER;

  // Close the mobile panel on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close the mobile panel on Escape key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll while the mobile panel is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-surface)_80%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-xl"
        >
          LLM<span className="text-[var(--color-accent)]"> Tracker</span>
        </Link>

        <nav
          aria-label="Primary"
          className="hidden flex-wrap items-center gap-x-5 gap-y-2 text-ui-sm lg:flex"
        >
          {LINKS.map((l) => {
            const Icon = l.icon;
            const href = navHref(linkProvider, l.suffix);
            const active =
              activeProvider !== null && isActive(pathname, href);
            return (
              <Link
                key={l.suffix || "home"}
                href={href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "relative inline-flex items-center gap-1.5 py-1 transition-colors",
                  active
                    ? "text-[var(--color-text-primary)] after:absolute after:inset-x-0 after:-bottom-[calc(0.75rem+1px)] after:h-0.5 after:bg-[var(--color-ring)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span>{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden lg:block">
          <ProviderSwitcher
            activeProvider={activeProvider}
            pathname={pathname}
          />
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="inline-flex size-11 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-raised)] lg:hidden"
        >
          {open ? (
            <X className="size-5" aria-hidden />
          ) : (
            <Menu className="size-5" aria-hidden />
          )}
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-x-0 top-full h-[100dvh] z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          />
          <nav
            id="mobile-nav"
            aria-label="Mobile primary"
            className="absolute inset-x-0 top-full z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] lg:hidden"
          >
            <div className="mx-auto max-w-6xl px-3 py-3">
              <p className="mb-2 text-meta text-[var(--color-text-muted)]">
                PROVIDER
              </p>
              <ProviderSwitcher
                activeProvider={activeProvider}
                pathname={pathname}
                onNavigate={() => setOpen(false)}
                size="full"
              />
            </div>
            <ul className="mx-auto flex max-w-6xl flex-col px-2 pb-2">
              {LINKS.map((l) => {
                const Icon = l.icon;
                const href = navHref(linkProvider, l.suffix);
                const active =
                  activeProvider !== null && isActive(pathname, href);
                return (
                  <li key={l.suffix || "home"}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "flex items-center gap-3 rounded-md px-3 py-3 text-ui-md transition-colors",
                        active
                          ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                      )}
                    >
                      <Icon
                        className={clsx(
                          "size-5",
                          active
                            ? "text-[var(--color-ring)]"
                            : "text-[var(--color-text-muted)]",
                        )}
                        aria-hidden
                      />
                      <span>{l.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      ) : null}
    </header>
  );
}
