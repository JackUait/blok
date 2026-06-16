import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "../common/Logo";
import { Search } from "../common/Search";
import { ThemeToggle } from "../common/ThemeToggle";
import { LanguageSelector } from "../common/LanguageSelector";
import { useI18n } from "../../contexts/I18nContext";
import type { NavLink } from "@/types/navigation";
import styles from "./Nav.module.css";

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

  const navClasses = [
    "nav",
    navScrolled ? "scrolled" : "",
    navHidden && !menuOpen ? "hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

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
      <nav className={navClasses} data-nav data-blok-testid="nav">
        <div className="nav-container">
          <Link to="/" className="nav-logo">
            <Logo size={36} />
            <p>Blok</p>
          </Link>

          {/* Center search pill — opens the command-K search dialog */}
          <button
            type="button"
            className={styles.searchPill}
            onClick={() => setSearchOpen(true)}
            aria-label={t("nav.searchAriaLabel")}
          >
            <span className={styles.searchPillLabel}>{t("search.placeholder")}</span>
            <span className={styles.searchPillIcon}>{searchIcon}</span>
          </button>

          {/* Right cluster: language, theme, account/menu pill */}
          <div className={styles.navRight}>
            <LanguageSelector />
            <ThemeToggle />

            <div className={styles.menu} ref={menuRef}>
              <button
                type="button"
                className={`${styles.menuPill} ${menuOpen ? styles.menuPillOpen : ""}`}
                aria-label={t("nav.toggleMenu")}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                data-nav-toggle
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <span className={styles.menuLines} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className={styles.menuAvatar} aria-hidden="true">
                  <Logo size={26} />
                </span>
              </button>

              <div
                className={`${styles.menuDropdown} ${menuOpen ? styles.menuDropdownOpen : ""}`}
                aria-hidden={!menuOpen}
              >
                {linksWithActive.map((link) => {
                  const itemClass = `${styles.menuItem} ${link.active ? styles.menuItemActive : ""} ${
                    link.external ? styles.menuItemStrong : ""
                  }`;

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
