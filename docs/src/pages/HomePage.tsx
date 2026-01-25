import { useEffect } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Hero } from '../components/home/Hero';
import { Features } from '../components/home/Features';
import { QuickStart } from '../components/home/QuickStart';
import { ApiPreview } from '../components/home/ApiPreview';
import { MigrationCard } from '../components/home/MigrationCard';
import { NAV_LINKS } from '../utils/constants';

export const HomePage: React.FC = () => {
  useEffect(() => {
    // Syntax highlighting
    const codeBlocks = document.querySelectorAll('code');
    codeBlocks.forEach((block) => {
      const blockElement = block;
      const originalHtml = blockElement.innerHTML;

      // Keywords
      const html = originalHtml.replace(
        /\b(import|from|const|let|var|function|class|new|return|if|else|async|await|export|default)\b/g,
        '<span class="token-keyword">$1</span>'
      )
        // Strings
        .replace(/(['"`])(.*?)\1/g, '<span class="token-string">$1$2$1</span>')
        // Comments
        .replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>')
        // Numbers
        .replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>')
        // Functions
        .replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="token-function">$1</span>(');

      blockElement.innerHTML = html;
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
        <Features />
        <QuickStart />
        <ApiPreview />
        <MigrationCard />
      </main>
      <Footer />
    </>
  );
};
