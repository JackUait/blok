import { useEffect, useRef, useState } from 'react';
import { FeatureModal, type FeatureDetail } from './FeatureModal';

const FEATURES: FeatureDetail[] = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        {/* JSON braces */}
        <path d="M12 8L8 16l4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 8l4 8-4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Clean JSON Output',
    description: (
      <>
        Content is structured as <strong>typed JSON blocks</strong>, not raw HTML. Parse, store, and render anywhere.
      </>
    ),
    accent: 'coral',
    details: {
      summary: 'Blok outputs clean, typed JSON data that\'s easy to store, transform, and render in any environment.',
      benefits: [
        'Store content in any database without HTML parsing',
        'Render on server, client, or native apps',
        'Full TypeScript types for all block data',
        'Easy content migration and transformation',
      ],
      codeExample: `const data = await editor.save();
// { blocks: [{ type: "paragraph", data: { text: "Hello" } }] }`,
      apiLink: '/docs#save',
    },
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
    description: (
      <>
        Press <kbd>/</kbd> or click <kbd>+</kbd> to open the block menu. Insert paragraphs, headers, lists, and custom blocks.
      </>
    ),
    accent: 'orange',
    details: {
      summary: 'A powerful command palette for quick block insertion. Users can type "/" to search and insert any block type.',
      benefits: [
        'Keyboard-first workflow with "/" commands',
        'Searchable block menu with fuzzy matching',
        'Custom shortcuts for frequently used blocks',
        'Accessible with full keyboard navigation',
      ],
      codeExample: `// Configure custom toolbox items
new Blok({
  tools: {
    myBlock: {
      class: MyBlockTool,
      toolbox: { title: 'My Block', icon: '<svg>...</svg>' }
    }
  }
});`,
    },
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
    description: (
      <>
        Select text to format with <strong>bold</strong>, <em>italic</em>, and links. Extensible with custom inline tools.
      </>
    ),
    accent: 'pink',
    details: {
      summary: 'A floating toolbar appears when text is selected, providing quick access to inline formatting options.',
      benefits: [
        'Context-aware formatting options',
        'Built-in bold, italic, and link tools',
        'Extensible with custom inline tools',
        'Smart positioning that stays in viewport',
      ],
      codeExample: `// Add custom inline tool
new Blok({
  tools: {
    highlight: {
      class: HighlightTool,
      inlineToolbar: true
    }
  }
});`,
    },
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
    description: (
      <>
        Rearrange blocks with <strong>drag handles</strong>. Pointer-based system works on touch and desktop.
      </>
    ),
    accent: 'mauve',
    details: {
      summary: 'Intuitive drag and drop reordering using a pointer-based system that works seamlessly on both touch and desktop devices.',
      benefits: [
        'Works on touch and desktop devices',
        'Visual drop indicators',
        'Smooth animations during drag',
        'Accessible keyboard alternatives',
      ],
    },
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
    description: (
      <>
        Extend the editor with <strong>custom blocks</strong>. Built-in paragraph, header, list tools included.
      </>
    ),
    accent: 'green',
    details: {
      summary: 'Create any block type you need. From simple text blocks to complex interactive components.',
      benefits: [
        'Simple API for creating custom blocks',
        'Built-in paragraph, header, and list tools',
        'Full lifecycle hooks (render, save, validate)',
        'Block tunes for additional settings',
      ],
      codeExample: `class MyTool {
  static get toolbox() {
    return { title: 'My Tool', icon: '<svg>...</svg>' };
  }
  render() { return document.createElement('div'); }
  save(element) { return { text: element.innerHTML }; }
}`,
      apiLink: '/docs#tools',
    },
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
    description: (
      <>
        Toggle read-only mode <strong>at runtime</strong>. Perfect for view-only contexts or permission-based editing.
      </>
    ),
    accent: 'cyan',
    details: {
      summary: 'Switch between edit and read-only modes at runtime without reinitializing the editor.',
      benefits: [
        'Toggle at runtime via API',
        'Perfect for permission-based editing',
        'Preserves content and scroll position',
        'Disables all editing interactions',
      ],
      codeExample: `// Toggle read-only mode
editor.readOnly.toggle();

// Or set explicitly
editor.readOnly.toggle(true);`,
      apiLink: '/docs#readonly',
    },
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
    description: (
      <>
        Full history support with <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd>. Never lose your work with automatic state tracking.
      </>
    ),
    accent: 'yellow',
    details: {
      summary: 'Comprehensive undo/redo with keyboard shortcuts and API access. All changes are tracked automatically.',
      benefits: [
        'Automatic change tracking',
        'Keyboard shortcuts (⌘Z / ⌘⇧Z)',
        'Programmatic undo/redo via API',
        'Configurable history depth',
      ],
    },
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
    description: (
      <>
        Lazy-loaded i18n with <strong>RTL support</strong>. Only English bundled by default <span className="feature-badge">~3KB</span>.
      </>
    ),
    accent: 'red',
    details: {
      summary: 'Full internationalization with 68 languages, RTL support, and lazy loading for optimal bundle size.',
      benefits: [
        '68 supported languages',
        'Full RTL layout support',
        'Lazy-loaded translations (~3KB base)',
        'Custom translation overrides',
      ],
      codeExample: `import { ar } from '@aspect/blok/locales';

new Blok({
  i18n: ar // Arabic with RTL
});`,
    },
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
    description: (
      <>
        Paste from <strong>Google Docs</strong>, or plain text. Content is sanitized and converted to blocks.
      </>
    ),
    accent: 'purple',
    details: {
      summary: 'Intelligent paste handling that converts content from various sources into clean blocks.',
      benefits: [
        'Paste from Google Docs, Word, and more',
        'Automatic HTML sanitization',
        'Preserves formatting as blocks',
        'Custom paste handlers per tool',
      ],
    },
  },
];

export const Features: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const [selectedFeature, setSelectedFeature] = useState<FeatureDetail | null>(null);

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

  const handleFeatureClick = (feature: FeatureDetail) => {
    setSelectedFeature(feature);
  };

  const handleCloseModal = () => {
    setSelectedFeature(null);
  };

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
            <button
              type="button"
              key={feature.title}
              className={`feature-card feature-card--${feature.accent}`}
              data-feature-card
              style={{ '--animation-order': index } as React.CSSProperties}
              onClick={() => handleFeatureClick(feature)}
              aria-label={`Learn more about ${feature.title}`}
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
            </button>
          ))}
        </div>
      </div>

      <FeatureModal feature={selectedFeature} onClose={handleCloseModal} />
    </section>
  );
};
