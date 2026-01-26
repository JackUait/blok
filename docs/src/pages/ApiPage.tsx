import { useEffect, useState } from 'react';
import { Nav } from '../components/layout/Nav';
import { ApiSidebar } from '../components/api/ApiSidebar';
import { ApiSection } from '../components/api/ApiSection';
import { API_SECTIONS } from '../components/api/api-data';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/api.css';

export const ApiPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState('core');

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

    // Smooth scroll for anchor links
    const handleAnchorClick = (e: Event) => {
      const target = e.target as HTMLAnchorElement;
      const href = target.getAttribute('href');
      if (!href || !href.startsWith('#')) return;

      const targetElement = document.querySelector(href);
      if (targetElement) {
        e.preventDefault();
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
    </>
  );
};
