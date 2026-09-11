"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  Activity,
  BookOpen,
  Boxes,
  Lightbulb,
  Map,
  Menu,
  Package,
  Rss,
  Terminal,
  X,
} from "lucide-react";
import { PROVIDERS, type Provider } from "@/lib/providers";
import {
  isSectionActive,
  providerFromPathname,
  swapProviderInPath,
} from "@/lib/provider-route";
import { getProviderMeta } from "@/lib/provider-meta";

const LINKS = [
  { suffix: "", label: "Learn", icon: BookOpen },
  { suffix: "/models", label: "Models", icon: Boxes },
  { suffix: "/releases", label: "Releases", icon: Terminal },
  { suffix: "/tips", label: "Tips", icon: Lightbulb },
  { suffix: "/guides", label: "Guides", icon: Map },
  { suffix: "/changelog", label: "Changelog", icon: Package },
  { suffix: "/status", label: "Status", icon: Activity },
];

export interface HeaderProps {
  contentAvailability?: { tips: Provider[]; guides: Provider[] };
}

export function Header({ contentAvailability }: HeaderProps = {}) {
  const pathname = usePathname() ?? "/";
  const provider = providerFromPathname(pathname);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const linkProvider = provider ?? "claude";
  const links = LINKS.filter(({ suffix }) => {
    if (!contentAvailability) return true;
    if (suffix === "/tips")
      return contentAvailability.tips.includes(linkProvider);
    if (suffix === "/guides")
      return contentAvailability.guides.includes(linkProvider);
    return true;
  });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (media.matches) setOpen(false);
    };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    if (!open) {
      if (panel.open) panel.close();
      return;
    }
    panel.showModal();
    const menuTrigger = trigger.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      if (panel.open) panel.close();
      menuTrigger?.focus();
    };
  }, [open]);

  const providerLinks = (mobile = false) => (
    <nav
      aria-label={mobile ? "Mobile providers" : "Providers"}
      className="provider-switcher"
    >
      {PROVIDERS.map((p) => {
        let target = swapProviderInPath(pathname, p);
        const section = target.split("/")[2];
        if (
          contentAvailability &&
          (section === "tips" || section === "guides") &&
          !contentAvailability[section].includes(p)
        )
          target = `/${p}`;
        return (
          <Link
            key={p}
            href={target}
            aria-current={provider === p ? "true" : undefined}
            style={{
              ["--provider-accent" as string]: getProviderMeta(p).accentVar,
            }}
            onClick={() => setOpen(false)}
          >
            <span className="provider-dot" aria-hidden />
            {getProviderMeta(p).label}
          </Link>
        );
      })}
    </nav>
  );
  const sectionLinks = (mobile = false) => (
    <nav
      aria-label={mobile ? "Mobile sections" : "Sections"}
      className={mobile ? "mobile-sections" : "section-nav"}
    >
      {links.map(({ suffix, label, icon: Icon }) => (
        <Link
          key={label}
          href={`/${linkProvider}${suffix}`}
          aria-current={
            provider && isSectionActive(pathname, provider, suffix)
              ? "page"
              : undefined
          }
          onClick={() => setOpen(false)}
        >
          <Icon size={16} aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="site-brand" aria-label="LLM Tracker home">
          <Terminal size={22} strokeWidth={1.7} aria-hidden />
          <span>
            LLM
            <span className="font-normal text-[var(--color-text-muted)]">
              {" "}
              Tracker
            </span>
          </span>
        </Link>
        <div className="hidden items-center gap-7 lg:flex">
          <Link
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
            className={clsx("overview-link", pathname === "/" && "is-current")}
          >
            Overview
          </Link>
          {providerLinks()}
        </div>
        <a
          href="/rss.xml"
          className="quiet-link ml-auto hidden gap-2 lg:inline-flex"
        >
          <Rss size={15} aria-hidden />
          Subscribe
        </a>
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Open menu"
          className="icon-button lg:hidden"
        >
          <Menu size={22} aria-hidden />
        </button>
      </div>
      {provider ? (
        <div className="hidden border-t border-[var(--color-border)] lg:block">
          <div className="header-sections">{sectionLinks()}</div>
        </div>
      ) : null}
      <dialog
        ref={dialog}
        id="mobile-nav"
        aria-label="Navigation"
        className="mobile-dialog"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "a[href], button:not([disabled]), input, select, [tabindex='0']",
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="mobile-dialog-body">
          <div className="mb-5 flex items-center justify-between">
            <span className="font-semibold">Explore LLM Tracker</span>
            <button
              type="button"
              aria-label="Close menu"
              className="icon-button"
              onClick={() => setOpen(false)}
            >
              <X size={20} aria-hidden />
            </button>
          </div>
          <Link
            href="/"
            onClick={() => setOpen(false)}
            aria-current={pathname === "/" ? "page" : undefined}
            className="mobile-overview"
          >
            All providers · Overview
          </Link>
          {providerLinks(true)}
          <p className="mb-2 mt-6 text-ui-sm text-[var(--color-text-muted)]">
            Explore {getProviderMeta(linkProvider).label}
          </p>
          {sectionLinks(true)}
          <a href="/rss.xml" className="quiet-link mt-5 inline-flex gap-2">
            <Rss size={16} aria-hidden />
            Subscribe to the feed
          </a>
        </div>
      </dialog>
    </header>
  );
}
