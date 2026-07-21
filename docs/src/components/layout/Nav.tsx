import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "../common/Logo";
import { Search } from "../common/Search";
import { ThemeToggle } from "../common/ThemeToggle";
import { GitHubLink } from "../common/GitHubLink";
import { LanguageSelector } from "../common/LanguageSelector";
import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import type { NavLink } from "@/types/navigation";
import { cn } from "@/lib/utils";
import { trackEvent, ANALYTICS_EVENTS } from "@/lib/analytics";

interface NavProps {
  links: NavLink[];
  /**
   * Pin the header to its full edge-to-edge form, suppressing the scroll-driven
   * morph into the compact frosted island. Used on the docs page.
   */
  keepExpanded?: boolean;
  /**
   * Render the header in normal document flow (position: static) instead of
   * pinned to the viewport, and skip the scroll-linked tuck-away animation.
   * Used on pages, like /demo, where the header shouldn't float over content.
   */
  staticPosition?: boolean;
}

export const Nav: React.FC<NavProps> = ({ links, keepExpanded = false, staticPosition = false }) => {
  const location = useLocation();
  const { t } = useI18n();
  const [navScrolled, setNavScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const lastScrollYRef = useRef(0);
  const hideOffsetRef = useRef(0);
  const menuOpenRef = useRef(false);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);

  // Determine active link based on current location
  const linksWithActive = useMemo(() => {
    const path = location.pathname;

    return links.map((link) => {
      if (link.external) return link;
      const linkPath = link.href.replace(/\/#.*$/, "");
      const isActive = path === linkPath;
      return { ...link, active: isActive };
    });
  }, [links, location.pathname]);

  // Drive the header's vertical position directly from the scroll gesture so it
  // tucks away and peeks back in proportion to how far you scroll — a continuous
  // scroll-linked motion rather than a binary snap. translateY(0) = fully shown,
  // translateY(-MAX_HIDE) = fully tucked above the viewport.
  useEffect(() => {
    // A static header sits in normal document flow and never tucks away.
    if (staticPosition) return;

    const HIDE_THRESHOLD = 80; // keep the bar pinned near the very top
    const MAX_HIDE = 120; // px of travel to fully clear the island + its shadow
    const HIDE_SPEED = 2; // bar travels Nx the scroll delta → hides over ~60px
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const handleScroll = () => {
      const scrollY = window.scrollY;
      const delta = scrollY - lastScrollYRef.current;
      setNavScrolled(scrollY > 20);

      // Pin the bar fully open near the top, while a menu is open, or under
      // reduced-motion. Otherwise accumulate the gesture: scrolling down adds to
      // the tuck offset, scrolling up subtracts, clamped so the bar can rest
      // anywhere between fully shown and fully tucked.
      const offset =
        reduceMotion || menuOpenRef.current || keepExpanded || scrollY <= HIDE_THRESHOLD
          ? 0
          : Math.min(
              Math.max(hideOffsetRef.current + delta * HIDE_SPEED, 0),
              MAX_HIDE,
            );
      hideOffsetRef.current = offset;
      lastScrollYRef.current = scrollY;

      const nav = navRef.current;
      if (nav) nav.style.transform = `translateY(${-offset}px)`;
    };

    const tickingState = { value: false };
    const onScroll = () => {
      if (!tickingState.value) {
        tickingState.value = true;
        window.requestAnimationFrame(() => {
          handleScroll();
          tickingState.value = false;
        });
      }
    };

    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [keepExpanded, staticPosition]);

  // Opening the menu pulls the bar fully back into view (smoothly), so the
  // dropdown never anchors to a half-tucked header.
  useEffect(() => {
    menuOpenRef.current = menuOpen;
    if (!menuOpen) return;
    hideOffsetRef.current = 0;
    const nav = navRef.current;
    if (nav) {
      nav.style.transition = "transform 300ms cubic-bezier(0.22,1,0.36,1)";
      nav.style.transform = "translateY(0px)";
      const clear = window.setTimeout(() => {
        nav.style.transition = "";
      }, 320);
      return () => window.clearTimeout(clear);
    }
  }, [menuOpen]);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Close menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;

    const handlePointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  // Handle Cmd/Ctrl + K to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const searchIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6.25" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M17.5 17.5l-4-4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );

  return (
    <>
      {/* Keyboard-only escape hatch past the many nav/sidebar links to the
          actual page content. Hidden until it receives focus (first Tab
          stop), then pops into view. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Skip to content
      </a>
      <nav
        ref={navRef}
        className={cn(
          "inset-x-0 top-0 z-40 px-3 sm:px-4",
          staticPosition ? "static" : "fixed will-change-transform",
        )}
        data-nav
        data-blok-testid="nav"
      >
        {/* The bar morphs between two states: an airy, edge-to-edge transparent
            strip at the very top, and — once scrolled — a compact frosted
            "island" that detaches from the screen edges (rounded, bordered,
            elevated). A coral hairline traces reading progress along its base. */}
        <div
          className={cn(
            "relative mx-auto flex w-full items-center justify-between gap-5 border transition-[height,max-width,border-radius,background-color,border-color,box-shadow,padding] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            // Compact frosted island — only when the morph is allowed (not on docs).
            navScrolled && !keepExpanded
              ? "mt-3.5 h-[4.5rem] max-w-5xl rounded-[1.75rem] border-border/70 bg-background/70 px-4 shadow-[0_14px_40px_-12px_rgba(17,17,17,0.3)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sm:px-6"
              // Docs: keep the full edge-to-edge bar, but once scrolled give it a
              // quiet frost + bottom hairline so content never bleeds through.
              : navScrolled && keepExpanded
                ? "mt-0 h-16 max-w-6xl rounded-none border-transparent border-b-border/60 bg-background/80 px-6 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65"
                : "mt-0 h-16 max-w-6xl rounded-none border-transparent bg-transparent px-6",
          )}
        >
          <Link
            to="/"
            className="nav-brand flex shrink-0 items-center gap-1.5 font-display text-xl font-extrabold tracking-tight"
          >
            <Logo size={42} className="nav-brand-mascot" />
            <img src="/logo-wordmark.png" alt="" className="nav-brand-wordmark h-7 w-auto" />
          </Link>

          {/* Center search — Airbnb-style pill: dark prompt on the left, a coral
              circular search button on the right. Expands inline into the search
              panel (no modal); collapses to an icon-only circle on small screens. */}
          <div className="relative flex justify-center sm:max-w-md sm:flex-1">
            <button
              ref={searchTriggerRef}
              type="button"
              className={cn(
                "group flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border/50 bg-background/55 backdrop-blur-md transition-colors duration-200 ease-out hover:border-border hover:bg-background/80 sm:h-12 sm:w-full sm:justify-between sm:pl-5 sm:pr-1.5",
                searchOpen && "pointer-events-none opacity-0",
              )}
              onClick={() => setSearchOpen(true)}
              aria-label={t("nav.searchAriaLabel")}
              aria-expanded={searchOpen}
            >
              {/* Small screens: plain coral glyph, centered */}
              <span className="flex size-[18px] shrink-0 items-center justify-center text-primary transition-transform duration-200 group-hover:scale-110 sm:hidden">
                {searchIcon}
              </span>

              {/* Desktop: dark prompt text */}
              <span className="hidden truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground/75 transition-colors group-hover:text-foreground sm:inline">
                <Typo>{t("search.placeholder")}</Typo>
              </span>

              {/* Desktop: ⌘K hint + coral search button */}
              <span className="ml-3 hidden items-center gap-2.5 sm:flex">
                <kbd className="hidden items-center gap-0.5 rounded-md bg-secondary px-1.5 py-1 font-mono text-[10px] font-semibold leading-none text-muted-foreground/70 transition-colors group-hover:bg-secondary/80 md:inline-flex">
                  <span className="text-[12px] leading-none">⌘</span>K
                </kbd>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-[0_1px_3px_rgba(225,29,72,0.35)] transition-transform duration-200 group-hover:scale-105">
                  {searchIcon}
                </span>
              </span>
            </button>

            <Search
              open={searchOpen}
              onClose={() => setSearchOpen(false)}
              tinted={navScrolled}
              triggerRef={searchTriggerRef}
            />
          </div>

          {/* Right cluster: language, theme, account/menu pill */}
          <div className="flex shrink-0 items-center gap-0.5">
            <LanguageSelector />
            <GitHubLink />
            <ThemeToggle />

            <span
              className="mx-1.5 hidden h-5 w-px bg-border sm:block"
              aria-hidden="true"
            />

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className={cn(
                  "flex size-9 cursor-pointer items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground",
                  menuOpen && "bg-secondary text-foreground",
                )}
                aria-label={t("nav.toggleMenu")}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                data-nav-toggle
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <span
                  className="flex flex-col items-center justify-center gap-[3.5px]"
                  aria-hidden="true"
                >
                  <span className="block h-[1.5px] w-[18px] rounded-full bg-current" />
                  <span className="block h-[1.5px] w-[18px] rounded-full bg-current" />
                  <span className="block h-[1.5px] w-[18px] rounded-full bg-current" />
                </span>
              </button>

              <div
                className={cn(
                  "absolute right-0 top-[calc(100%+0.625rem)] z-50 flex min-w-[14rem] origin-top-right flex-col rounded-2xl border border-border bg-popover p-2 shadow-card transition-all duration-150",
                  menuOpen
                    ? "pointer-events-auto scale-100 opacity-100"
                    : "pointer-events-none scale-95 opacity-0",
                )}
                aria-hidden={!menuOpen}
              >
                {linksWithActive.map((link) => {
                  const itemClass = cn(
                    "rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-secondary",
                    link.active && "active bg-secondary text-foreground",
                    link.external && "text-foreground",
                  );

                  if (link.external) {
                    return (
                      <a
                        key={link.href}
                        href={link.href}
                        className={itemClass}
                        target="_blank"
                        rel="noopener noreferrer"
                        tabIndex={menuOpen ? 0 : -1}
                      >
                        {link.i18nKey ? t(link.i18nKey) : link.label}
                      </a>
                    );
                  }

                  return (
                    <Link
                      key={link.href}
                      to={link.href}
                      className={itemClass}
                      tabIndex={menuOpen ? 0 : -1}
                      onClick={() => {
                        // External links are covered by the global outbound
                        // tracker; only internal destinations are reported here.
                        // The untranslated label keeps the GA dimension stable
                        // across locales.
                        trackEvent(ANALYTICS_EVENTS.navLinkClick, {
                          label: link.label,
                          to: link.href,
                        });
                        setMenuOpen(false);
                      }}
                    >
                      {link.i18nKey ? t(link.i18nKey) : link.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
};
