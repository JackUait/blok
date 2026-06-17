import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "../common/Logo";
import { Search } from "../common/Search";
import { ThemeToggle } from "../common/ThemeToggle";
import { LanguageSelector } from "../common/LanguageSelector";
import { useI18n } from "../../contexts/I18nContext";
import type { NavLink } from "@/types/navigation";
import { cn } from "@/lib/utils";

interface NavProps {
  links: NavLink[];
}

export const Nav: React.FC<NavProps> = ({ links }) => {
  const location = useLocation();
  const { t } = useI18n();
  const [navScrolled, setNavScrolled] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const lastScrollYRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const HIDE_THRESHOLD = 80;
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const lastY = lastScrollYRef.current;
      setNavScrolled(scrollY > 20);
      if (scrollY <= HIDE_THRESHOLD) {
        setNavHidden(false);
      } else if (scrollY > lastY) {
        setNavHidden(true);
      } else if (scrollY < lastY) {
        setNavHidden(false);
      }
      lastScrollYRef.current = scrollY;
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
  }, []);

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
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <>
      <nav
        className={cn(
          "fixed inset-x-0 top-0 z-40 transition-[transform,box-shadow,background-color,border-color] duration-300 border-b",
          navScrolled
            ? "border-border bg-background/85 shadow-sm backdrop-blur-xl"
            : "border-transparent bg-background/60 backdrop-blur-md",
          navHidden && !menuOpen ? "nav-hidden -translate-y-full" : "translate-y-0",
        )}
        data-nav
        data-blok-testid="nav"
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 font-display text-xl font-extrabold tracking-tight"
          >
            <Logo size={34} />
            <p>Blok</p>
          </Link>

          {/* Center search pill — opens the command-K search dialog.
              Collapses to an icon-only circle on small screens. */}
          <button
            type="button"
            className="flex h-10 items-center justify-center gap-4 rounded-full border border-border bg-background text-sm font-medium text-muted-foreground shadow-sm transition-all hover:border-foreground/20 hover:shadow-card-hover sm:h-11 sm:max-w-sm sm:flex-1 sm:justify-between sm:px-5 size-10 sm:size-auto"
            onClick={() => setSearchOpen(true)}
            aria-label={t("nav.searchAriaLabel")}
          >
            <span className="hidden sm:inline">{t("search.placeholder")}</span>
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
              {searchIcon}
            </span>
          </button>

          {/* Right cluster: language, theme, account/menu pill */}
          <div className="flex shrink-0 items-center gap-1">
            <LanguageSelector />
            <ThemeToggle />

            <div className="relative ml-1" ref={menuRef}>
              <button
                type="button"
                className={cn(
                  "flex h-10 items-center gap-2.5 rounded-full border border-border bg-background py-1 pr-1 pl-3.5 transition-all hover:shadow-card-hover hover:border-foreground/20",
                  menuOpen && "shadow-card-hover border-foreground/20",
                )}
                aria-label={t("nav.toggleMenu")}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                data-nav-toggle
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <span
                  className="flex flex-col items-end justify-center gap-[3px]"
                  aria-hidden="true"
                >
                  <span className="block h-0.5 w-4 rounded-full bg-foreground" />
                  <span className="block h-0.5 w-4 rounded-full bg-foreground" />
                  <span className="block h-0.5 w-4 rounded-full bg-foreground" />
                </span>
                <span
                  className="flex size-7 items-center justify-center overflow-hidden rounded-full bg-secondary"
                  aria-hidden="true"
                >
                  <Logo size={24} />
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
                      onClick={() => setMenuOpen(false)}
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
      <Search open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
};
