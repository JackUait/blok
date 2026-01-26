import { useEffect } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Hero } from '../components/home/Hero';
import { Features } from '../components/home/Features';
import { QuickStart } from '../components/home/QuickStart';
import { ApiPreview } from '../components/home/ApiPreview';
import { MigrationCard } from '../components/home/MigrationCard';
import { WaveDivider } from '../components/common/WaveDivider';
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
          behavior: 'smooth',
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
        <div className="section-wrapper section-wrapper--features">
          <Features />
          <WaveDivider
            variant="layered"
            fillColor="var(--color-background)"
            height={100}
            position="bottom"
          />
        </div>
        <div className="section-wrapper section-wrapper--quickstart">
          <QuickStart />
          <WaveDivider
            variant="curved"
            fillColor="var(--color-surface)"
            height={90}
            position="bottom"
          />
        </div>
        <div className="section-wrapper section-wrapper--api">
          <ApiPreview />
          <WaveDivider
            variant="asymmetric"
            fillColor="var(--color-background)"
            height={80}
            position="bottom"
          />
        </div>
        <MigrationCard />
      </main>
      <Footer />
    </>
  );
};
