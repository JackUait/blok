interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <path
          d="M10 8h12c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H10c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2z"
          stroke="white"
          strokeWidth="2"
        />
        <rect x="12" y="12" width="8" height="2" rx="1" fill="white" />
        <rect x="12" y="16" width="6" height="2" rx="1" fill="white" opacity="0.7" />
        <rect x="12" y="20" width="7" height="2" rx="1" fill="white" opacity="0.7" />
      </svg>
    ),
    title: 'Block Architecture',
    description:
      'Content is structured as JSON data, not raw HTML. Parse, store, and render anywhere with ease.',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <path
          d="M16 6l-8 4.67v9.66L16 25l8-4.67V10.67L16 6z"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M12 14l4 2 4-2M16 16v5M16 16l-4-2M16 16l4-2"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: 'Slash Commands',
    description: 'Built-in, customizable slash menu for quick formatting and inserting media.',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="6" stroke="white" strokeWidth="2" />
        <path d="M16 10V6M16 26v-4M10 16H6m20 0h-4" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: 'Headless & Stylable',
    description:
      'Blok gives you the logic; you bring the UI. Compatible with Tailwind, Styled Components, or raw CSS.',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <path d="M8 12h16M8 16h12M8 20h16" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <circle cx="26" cy="22" r="3" stroke="white" strokeWidth="2" />
      </svg>
    ),
    title: 'Drag & Drop',
    description: 'Native support for rearranging blocks with intuitive drag handles.',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <path d="M16 8v16M8 16h16" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="8" r="2" fill="white" />
        <circle cx="8" cy="16" r="2" fill="white" />
        <circle cx="24" cy="16" r="2" fill="white" />
        <circle cx="16" cy="24" r="2" fill="white" />
      </svg>
    ),
    title: 'Extensible Plugin System',
    description: 'Create custom blocks for Kanbans, Embeds, Code Blocks, and more.',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="8" stroke="white" strokeWidth="2" />
        <path d="M12 16h8M16 12v8" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: '68 Languages',
    description: 'Lazy-loaded locale support with only English bundled by default (~3KB).',
  },
];

export const Features: React.FC = () => {
  return (
    <section className="features" id="features">
      <div className="container">
        <div className="section-header">
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
              className="feature-card"
              data-feature-card
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="feature-icon">{feature.icon}</div>
              <h3 className="feature-title">{feature.title}</h3>
              <p className="feature-description">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
