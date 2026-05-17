"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type AriaAttributes,
  type FocusEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";

export interface PopoverPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
}

interface TriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  type: "button";
  "aria-describedby": string | undefined;
  "aria-expanded": AriaAttributes["aria-expanded"];
  onPointerEnter: PointerEventHandler<HTMLButtonElement>;
  onPointerLeave: PointerEventHandler<HTMLButtonElement>;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onFocus: FocusEventHandler<HTMLButtonElement>;
  onBlur: FocusEventHandler<HTMLButtonElement>;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

interface PanelProps {
  ref: RefObject<HTMLDivElement | null>;
  id: string;
  role: "tooltip";
  style: { left: number; top: number };
  "data-placement": "top" | "bottom" | undefined;
}

export interface AnchoredPopover {
  open: boolean;
  setOpen: (next: boolean | ((current: boolean) => boolean)) => void;
  mounted: boolean;
  position: PopoverPosition | null;
  triggerProps: TriggerProps;
  panelProps: PanelProps;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

/**
 * Drives a portal-rendered popover anchored to a trigger button. The panel is
 * clamped inside the visual viewport on every scroll/resize/zoom so it cannot
 * escape its bounds on small screens, mobile keyboard insets, or pinch-zoom.
 *
 * @param extraPanelRef - Optional additional ref whose subtree should be
 *   excluded from the click-outside dismissal check. Used by useDocOverlay to
 *   exclude the bottom-sheet panel so the window pointerdown listener does not
 *   close the sheet when the user taps inside it.
 */
export function useAnchoredPopover(
  extraPanelRef?: RefObject<HTMLElement | null>,
): AnchoredPopover {
  const tipId = useId();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  // Touch taps emit focus → click; focus-open must no-op for touch so click
  // can authoritatively toggle. Reset after the click settles.
  const suppressFocusOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const compute = useCallback(() => {
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;

    const anchorRect = anchor.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();

    // Prefer visualViewport when available so mobile keyboards / pinch-zoom
    // shrink the usable area correctly. Fall back to layout viewport.
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const vOffsetTop = vv?.offsetTop ?? 0;
    const vOffsetLeft = vv?.offsetLeft ?? 0;

    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const rawLeft = anchorCenter - tipRect.width / 2;
    const minLeft = vOffsetLeft + VIEWPORT_MARGIN;
    const maxLeft = Math.max(minLeft, vOffsetLeft + vw - tipRect.width - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(rawLeft, minLeft), maxLeft);

    const spaceAbove = anchorRect.top - vOffsetTop;
    const spaceBelow = vOffsetTop + vh - anchorRect.bottom;
    const needed = tipRect.height + ANCHOR_GAP;
    const placement: "top" | "bottom" =
      spaceAbove >= needed || spaceAbove >= spaceBelow ? "top" : "bottom";
    const rawTop =
      placement === "top"
        ? anchorRect.top - tipRect.height - ANCHOR_GAP
        : anchorRect.bottom + ANCHOR_GAP;
    const minTop = vOffsetTop + VIEWPORT_MARGIN;
    const maxTop = Math.max(minTop, vOffsetTop + vh - tipRect.height - VIEWPORT_MARGIN);
    const top = Math.min(Math.max(rawTop, minTop), maxTop);

    setPosition((prev) => {
      if (
        prev &&
        prev.left === left &&
        prev.top === top &&
        prev.placement === placement
      ) {
        return prev;
      }
      return { left, top, placement };
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    compute();
  }, [open, compute]);

  useEffect(() => {
    if (!open) return;

    const onScroll = () => compute();
    const onResize = () => compute();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target)) return;
      if (tipRef.current?.contains(target)) return;
      if (extraPanelRef?.current?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onScroll);
    };
  }, [open, compute, extraPanelRef]);

  const triggerProps: TriggerProps = {
    ref: anchorRef,
    type: "button",
    "aria-describedby": open ? tipId : undefined,
    "aria-expanded": open,
    onPointerEnter: (e) => {
      if (e.pointerType === "mouse") setOpen(true);
    },
    onPointerLeave: (e) => {
      if (e.pointerType === "mouse") setOpen(false);
    },
    onPointerDown: (e) => {
      if (e.pointerType !== "mouse") suppressFocusOpenRef.current = true;
    },
    onFocus: () => {
      if (suppressFocusOpenRef.current) return;
      setOpen(true);
    },
    onBlur: () => {
      suppressFocusOpenRef.current = false;
      setOpen(false);
    },
    onClick: (e) => {
      // Stop bubbling so the trigger does not also fire an ancestor <a> link
      // when the DocPopover button is rendered inside linked content (e.g. MDX
      // fallback anchor wrapping a resolved code token).
      e.stopPropagation();
      suppressFocusOpenRef.current = false;
      setOpen((o) => !o);
    },
  };

  const panelProps: PanelProps = {
    ref: tipRef,
    id: tipId,
    role: "tooltip",
    style: {
      left: position?.left ?? 0,
      top: position?.top ?? 0,
    },
    "data-placement": position?.placement,
  };

  return { open, setOpen, mounted, position, triggerProps, panelProps };
}

// ---------------------------------------------------------------------------
// useDocOverlay — responsive wrapper over useAnchoredPopover.
//
// >= SHEET_BREAKPOINT: behaves exactly like useAnchoredPopover (anchored
//   tooltip; hover + click + focus). The existing API is untouched so any
//   future caller of useAnchoredPopover keeps working.
// <  SHEET_BREAKPOINT: renders as a focus-trapped bottom-sheet dialog —
//   click/tap only (no hover/focus open), ESC + backdrop close, body scroll
//   lock while open, role="dialog" + aria-modal.
// ---------------------------------------------------------------------------

const SHEET_BREAKPOINT = 640;

interface SheetPanelProps {
  ref: RefObject<HTMLDivElement | null>;
  id: string;
  role: "dialog";
  "aria-modal": true;
  tabIndex: -1;
}

export interface DocOverlay {
  open: boolean;
  setOpen: (next: boolean | ((current: boolean) => boolean)) => void;
  mounted: boolean;
  /** True once the viewport is known to be below the sheet breakpoint. */
  isSheet: boolean;
  position: PopoverPosition | null;
  triggerProps: TriggerProps;
  /** Anchored-tooltip panel props (desktop). */
  panelProps: PanelProps;
  /** Bottom-sheet dialog panel props (mobile). */
  sheetProps: SheetPanelProps;
}

/**
 * Drives the doc popover. Anchored tooltip on >=640px, focus-trapped
 * bottom-sheet on smaller viewports. Built on top of useAnchoredPopover so
 * the desktop behavior (viewport clamping, ESC/outside-click, ARIA) is shared
 * verbatim rather than reimplemented.
 */
export function useDocOverlay(): DocOverlay {
  const sheetId = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Pass sheetRef as the extra-exclusion ref so the base's window pointerdown
  // listener does not call setOpen(false) when the user taps inside the sheet.
  const base = useAnchoredPopover(sheetRef);
  const { open, setOpen, mounted, triggerProps } = base;
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [isSheet, setIsSheet] = useState(false);

  // Track the breakpoint. Defaults to false so SSR/first paint matches the
  // anchored path; corrected on mount before the panel can be opened.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${SHEET_BREAKPOINT - 0.02}px)`);
    const apply = () => setIsSheet(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  // Sheet-only: body scroll lock, ESC close, focus trap, restore focus.
  useEffect(() => {
    if (!open || !isSheet) return;

    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const sheet = sheetRef.current;
    // Move focus into the sheet so the trap has a starting point.
    sheet?.focus();

    const focusable = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === sheet);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === sheet)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      body.style.overflow = prevOverflow;
      lastFocusedRef.current?.focus?.();
    };
  }, [open, isSheet, setOpen]);

  // Click-to-open on every viewport. Hover/focus no longer open and
  // pointer-leave/blur no longer close — a content-rich popover that vanishes
  // when the cursor leaves is bad UX (you can't reach the links inside it).
  // Open is the trigger click (keyboard Enter/Space fires it too); close is
  // the panel's explicit X button, plus ESC / click-outside from the base.
  const wrappedTrigger: TriggerProps = {
    ...triggerProps,
    onPointerEnter: () => {},
    onPointerLeave: () => {},
    onFocus: () => {},
    onBlur: () => {},
    "aria-describedby": !isSheet && open ? base.panelProps.id : undefined,
    "aria-expanded": open,
  };

  const sheetProps: SheetPanelProps = {
    ref: sheetRef,
    id: sheetId,
    role: "dialog",
    "aria-modal": true,
    tabIndex: -1,
  };

  return {
    open,
    setOpen,
    mounted,
    isSheet,
    position: base.position,
    triggerProps: wrappedTrigger,
    panelProps: base.panelProps,
    sheetProps,
  };
}
