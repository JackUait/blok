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
    // Initialize scroll animations
    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -100px 0px',
      threshold: 0.1,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Feature cards
    document.querySelectorAll('[data-feature-card]').forEach((el) => {
      observer.observe(el);
    });

    // Install steps
    document.querySelectorAll('[data-install-step]').forEach((el) => {
      observer.observe(el);
    });

    // Syntax highlighting
    const codeBlocks = document.querySelectorAll('code');
    codeBlocks.forEach((block) => {
      let html = block.innerHTML;

      // Keywords
      html = html.replace(
        /\b(import|from|const|let|var|function|class|new|return|if|else|async|await|export|default)\b/g,
        '<span class="token-keyword">$1</span>'
      );

      // Strings
      html = html.replace(/(['"`])(.*?)\1/g, '<span class="token-string">$1$2$1</span>');

      // Comments
      html = html.replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>');

      // Numbers
      html = html.replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>');

      // Functions
      html = html.replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="token-function">$1</span>(');

      block.innerHTML = html;
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

    // Add animate-in styles dynamically
    const style = document.createElement('style');
    style.textContent = `
      [data-feature-card],
      [data-install-step] {
        opacity: 0;
        transform: translateY(20px);
        transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1),
                    transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
      }

      [data-feature-card].animate-in,
      [data-install-step].animate-in {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    return () => {
      observer.disconnect();
      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.removeEventListener('click', handleAnchorClick);
      });
      document.head.removeChild(style);
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
