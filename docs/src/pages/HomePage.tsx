import { useEffect } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Hero } from '../components/home/Hero';
import { CategoryBar } from '../components/home/CategoryBar';
import { Features } from '../components/home/Features';
import { QuickStart } from '../components/home/QuickStart';
import { ApiPreview } from '../components/home/ApiPreview';
import { MigrationCard } from '../components/home/MigrationCard';
import { NAV_LINKS } from '../utils/constants';

export const HomePage: React.FC = () => {
  useEffect(() => {
    // Smooth scroll for anchor links
    const handleAnchorClick = (e: Event) => {
      const target = e.target as HTMLAnchorElement;
      const href = target.getAttribute('href');
      if (!href || !href.startsWith('#')) return;

      const targetElement = document.querySelector(href);
      if (targetElement) {
        e.preventDefault();
        targetElement.scrollIntoView({
          behavior: 'auto',
          block: 'start',
        });
      }
    };

    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', handleAnchorClick);
    });

    // Theme detection
    const detectTheme = () => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark-theme', prefersDark);

      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        document.documentElement.classList.toggle('dark-theme', e.matches);
      });
    };

    detectTheme();

    return () => {
      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.removeEventListener('click', handleAnchorClick);
      });
    };
  }, []);

  return (
    <>
      <Nav links={NAV_LINKS} />
      <main>
        <Hero />
        <CategoryBar />
        <div className="section-wrapper section-wrapper--features">
          <Features />
        </div>
        <div className="section-wrapper section-wrapper--quickstart">
          <QuickStart />
        </div>
        <div className="section-wrapper section-wrapper--api">
          <ApiPreview />
        </div>
        <MigrationCard />
      </main>
      <Footer />
    </>
  );
};
