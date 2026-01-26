import { useEffect, useState, useCallback, useRef } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { ApiSidebar } from '../components/api/ApiSidebar';
import { ApiSection } from '../components/api/ApiSection';
import { API_SECTIONS } from '../components/api/api-data';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/api.css';

export const ApiPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState('core');
  const scrollTargetRef = useRef<string | null>(null);

  // Handle initial URL hash on page load and hash changes
  const scrollToHash = useCallback(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    // Small delay to ensure DOM is fully rendered
    requestAnimationFrame(() => {
      const targetElement = document.getElementById(hash);
      if (targetElement) {
        scrollTargetRef.current = hash;
        setActiveSection(hash);
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, []);

  // Handle initial hash on mount
  useEffect(() => {
    scrollToHash();

    // Listen for hash changes (back/forward navigation)
    const handleHashChange = (): void => {
      scrollToHash();
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [scrollToHash]);

  useEffect(() => {
    // Intersection Observer for active section tracking
    const observerOptions = {
      root: null,
      rootMargin: '-100px 0px -100px 0px',
      threshold: 0.1,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          // If we're scrolling to a target, only update when we reach it
          if (scrollTargetRef.current) {
            if (entry.target.id === scrollTargetRef.current) {
              scrollTargetRef.current = null;
            }
            return;
          }
          setActiveSection(entry.target.id);
        }
      });
    }, observerOptions);

    // Observe all sections
    API_SECTIONS.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) {
        observer.observe(element);
      }
    });

    // Handle anchor link clicks - update URL hash and scroll
    const handleAnchorClick = (e: Event) => {
      const target = e.target as HTMLAnchorElement;
      const href = target.getAttribute('href');
      if (!href || !href.startsWith('#')) return;

      const sectionId = href.slice(1);
      const targetElement = document.querySelector(href);
      if (targetElement) {
        e.preventDefault();
        
        // Update URL hash (enables sharing/bookmarking)
        window.history.pushState(null, '', href);
        
        // Track target and update active section immediately
        scrollTargetRef.current = sectionId;
        setActiveSection(sectionId);
        
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    };

    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', handleAnchorClick);
    });

    return () => {
      observer.disconnect();
      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.removeEventListener('click', handleAnchorClick);
      });
    };
  }, []);

  return (
    <>
      <Nav links={NAV_LINKS} />
      <div className="api-docs" data-blok-testid="api-docs">
        <ApiSidebar activeSection={activeSection} />
        <main className="api-main" data-blok-testid="api-main">
          {API_SECTIONS.map((section) => (
            <ApiSection key={section.id} section={section} />
          ))}
        </main>
      </div>
      <Footer />
    </>
  );
};
