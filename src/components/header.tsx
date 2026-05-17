"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  Activity,
  BookOpen,
  Lightbulb,
  Map,
  Menu,
  Package,
  Sparkles,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const LINKS: NavItem[] = [
  { href: "/", label: "Learn", icon: BookOpen },
  { href: "/models", label: "Models", icon: Sparkles },
  { href: "/claude-code", label: "Claude Code", icon: Terminal },
  { href: "/tips", label: "Tips", icon: Lightbulb },
  { href: "/guides", label: "Guides", icon: Map },
  { href: "/changelog", label: "Changelog", icon: Package },
  { href: "/status", label: "Status", icon: Activity },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  // Close the mobile panel on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
          claude<span className="text-[var(--color-accent)]">.tracker</span>
        </Link>

        <nav
          aria-label="Primary"
          className="hidden flex-wrap items-center gap-x-5 gap-y-2 text-ui-sm md:flex"
        >
          {LINKS.map((l) => {
            const Icon = l.icon;
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
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

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="inline-flex size-11 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-raised)] md:hidden"
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
            className="absolute inset-x-0 top-full h-[100dvh] z-30 bg-black/40 backdrop-blur-sm md:hidden"
          />
          <nav
            id="mobile-nav"
            aria-label="Mobile primary"
            className="absolute inset-x-0 top-full z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] md:hidden"
          >
            <ul className="mx-auto flex max-w-6xl flex-col px-2 py-2">
              {LINKS.map((l) => {
                const Icon = l.icon;
                const active = isActive(pathname, l.href);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
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
