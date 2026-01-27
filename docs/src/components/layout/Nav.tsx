import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "../common/Logo";
import { Search } from "../common/Search";
import { ThemeToggle } from "../common/ThemeToggle";
import type { NavLink } from "@/types/navigation";
import searchStyles from "../common/Search.module.css";

interface NavProps {
  links: NavLink[];
}

export const Nav: React.FC<NavProps> = ({ links }) => {
  const location = useLocation();
  const [navScrolled, setNavScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Determine active link based on current location
  const linksWithActive = useMemo(() => {
    const path = location.pathname;

    return links.map((link) => {
      // External links are never active
      if (link.external) return link;

      // Check if this link matches the current path
      const linkPath = link.href.replace(/\/#.*$/, ""); // Remove anchor for comparison
      const isActive = path === linkPath;

      return { ...link, active: isActive };
    });
  }, [links, location.pathname]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      // Track scrolled state for visual enhancement
      setNavScrolled(scrollY > 20);
    };

    const tickingState = { value: false };
    const onScroll = () => {
      if (!tickingState.value) {
        window.requestAnimationFrame(() => {
          handleScroll();
          tickingState.value = false;
        });
        tickingState.value = true;
      }
    };

    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  const getLinkClassName = (link: NavLink): string => {
    const baseClass = "nav-link";
    if (link.active) return `${baseClass} nav-link-active`;
    if (link.external) return `${baseClass} nav-link-github`;
    return baseClass;
  };

  const navClasses = ["nav", navScrolled ? "scrolled" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <nav className={navClasses} data-nav data-blok-testid="nav">
        <div className="nav-container">
          <Link to="/" className="nav-logo">
            <Logo size={48} />
            <p>Blok</p>
          </Link>
          <div className={`nav-links ${menuOpen ? "open" : ""}`}>
            <button
              className={searchStyles["nav-search-button"]}
              onClick={() => setSearchOpen(true)}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                <path
                  d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Search</span>
              <kbd className={searchStyles["nav-search-shortcut"]}>⌘K</kbd>
            </button>
            {linksWithActive.map((link) => {
              if (link.external) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    className={getLinkClassName(link)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label}
                  </a>
                );
              }
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  className={getLinkClassName(link)}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </Link>
              );
            })}
            <ThemeToggle />
          </div>
          <button
            className={`nav-toggle ${menuOpen ? "active" : ""}`}
            aria-label="Toggle menu"
            data-nav-toggle
            onClick={() => setMenuOpen(!menuOpen)}
            type="button"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </nav>
      <Search open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
};
