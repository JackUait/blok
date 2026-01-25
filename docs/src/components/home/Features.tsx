import { useEffect, useRef } from 'react';

interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: 'coral' | 'orange' | 'pink' | 'mauve' | 'green' | 'cyan' | 'yellow' | 'red' | 'purple';
}

const FEATURES: Feature[] = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* JSON braces */}
        <path d="M12 8L8 16l4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 8l4 8-4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Clean JSON Output',
    description:
      'Content is structured as typed JSON blocks, not raw HTML. Parse, store, and render anywhere.',
    accent: 'coral',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* Command palette / menu box with slash */}
        <rect x="6" y="8" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M18 12L14 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Toolbox & Slash Commands',
    description: 'Press "/" or click "+" to open the block menu. Insert paragraphs, headers, lists, and custom blocks.',
    accent: 'orange',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* Bold A with underline - text formatting */}
        <text x="16" y="20" textAnchor="middle" fontSize="14" fontWeight="bold" fill="currentColor">A</text>
        <path d="M10 24h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Inline Toolbar',
    description:
      'Select text to format with bold, italic, and links. Extensible with custom inline tools.',
    accent: 'pink',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* Drag handle dots */}
        <circle cx="12" cy="10" r="2" fill="currentColor" />
        <circle cx="20" cy="10" r="2" fill="currentColor" />
        <circle cx="12" cy="16" r="2" fill="currentColor" />
        <circle cx="20" cy="16" r="2" fill="currentColor" />
        <circle cx="12" cy="22" r="2" fill="currentColor" opacity="0.5" />
        <circle cx="20" cy="22" r="2" fill="currentColor" opacity="0.5" />
      </svg>
    ),
    title: 'Drag & Drop',
    description: 'Rearrange blocks with drag handles. Pointer-based system works on touch and desktop.',
    accent: 'mauve',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* Stacked blocks - building blocks */}
        <rect x="6" y="6" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
        <rect x="16" y="10" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
        <rect x="8" y="18" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    title: 'Custom Block Tools',
    description: 'Extend the editor with custom blocks. Built-in paragraph, header, list tools included.',
    accent: 'green',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* Eye icon - view only */}
        <path d="M4 16s4-8 12-8 12 8 12 8-4 8-12 8-12-8-12-8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    title: 'Read-Only Mode',
    description: 'Toggle read-only mode at runtime. Perfect for view-only contexts or permission-based editing.',
    accent: 'cyan',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* Undo/Redo curved arrows */}
        <path d="M10 16a6 6 0 0 1 6-6h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 16a6 6 0 0 1-6 6h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <path d="M16 25l-3-3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      </svg>
    ),
    title: 'Undo & Redo',
    description: 'Full history support with keyboard shortcuts. Never lose your work with automatic state tracking.',
    accent: 'yellow',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* Globe / language icon */}
        <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="2" />
        <ellipse cx="16" cy="16" rx="4" ry="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 12h18M7 20h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: '68 Languages',
    description: 'Lazy-loaded i18n with RTL support. Only English bundled by default (~3KB overhead).',
    accent: 'red',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* Clipboard */}
        <rect x="8" y="6" width="16" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M12 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" />
        <path d="M12 13h8M12 17h6M12 21h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      </svg>
    ),
    title: 'Smart Paste',
    description: 'Paste from anywhere — Word, Google Docs, or plain text. Content is sanitized and converted to blocks.',
    accent: 'purple',
  },
];

export const Features: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('features-visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section className="features" id="features" ref={sectionRef}>
      {/* Decorative background elements */}
      <div className="features-bg">
        <div className="features-blob features-blob-1" />
        <div className="features-blob features-blob-2" />
        <div className="features-grid-pattern" />
      </div>

      <div className="container">
        <div className="section-header">
          <span className="section-eyebrow">Why Blok</span>
          <h2 className="section-title">
            Built for developers,
            <br />
            designed for users
          </h2>
          <p className="section-description">
            Everything you need to create powerful editing experiences in your applications.
          </p>
        </div>
        <div className="features-grid">
          {FEATURES.map((feature, index) => (
            <div
              key={feature.title}
              className={`feature-card feature-card--${feature.accent}`}
              data-feature-card
              style={{ '--animation-order': index } as React.CSSProperties}
            >
              <div className="feature-card-glow" />
              <div className="feature-card-content">
                <div className="feature-icon">
                  <div className="feature-icon-inner">{feature.icon}</div>
                </div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
              </div>
              <div className="feature-card-shine" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
