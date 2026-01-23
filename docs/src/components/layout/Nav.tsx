import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Logo } from '../common/Logo';
import type { NavLink } from '@/types/navigation';
import styles from './Nav.module.css';

interface NavProps {
  links: NavLink[];
}

export const Nav: React.FC<NavProps> = ({ links }) => {
  const location = useLocation();
  const [lastScrollY, setLastScrollY] = useState(0);
  const [navHidden, setNavHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Determine active link based on current location
  const linksWithActive = useMemo(() => {
    const path = location.pathname;

    return links.map((link) => {
      // External links are never active
      if (link.external) return link;

      // Check if this link matches the current path
      const linkPath = link.href.replace(/\/#.*$/, ''); // Remove anchor for comparison
      const isActive = path === linkPath;

      return { ...link, active: isActive };
    });
  }, [links, location.pathname]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;

      if (scrollY > 100) {
        if (scrollY > lastScrollY && !navHidden) {
          setNavHidden(true);
        } else if (scrollY < lastScrollY && navHidden) {
          setNavHidden(false);
        }
      } else {
        setNavHidden(false);
      }

      setLastScrollY(scrollY);
    };

    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, [lastScrollY, navHidden]);

  const getLinkClassName = (link: NavLink): string => {
    const baseClass = 'nav-link';
    if (link.active) return `${baseClass} nav-link-active`;
    if (link.external) return `${baseClass} nav-link-github`;
    return baseClass;
  };

  return (
    <nav className={`nav ${navHidden ? styles.hidden : ''}`} data-nav>
      <div className="nav-container">
        <Link to="/" className="nav-logo">
          <Logo size={32} />
          <span>Blok</span>
        </Link>
        <div className={`nav-links ${menuOpen ? 'open' : ''}`}>
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
        </div>
        <button
          className={`nav-toggle ${menuOpen ? 'active' : ''}`}
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
  );
};
