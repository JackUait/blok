interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#007AFF" fillOpacity="0.1" />
        <path
          d="M10 8h12c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H10c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2z"
          stroke="#007AFF"
          strokeWidth="2"
        />
        <rect x="12" y="12" width="8" height="2" rx="1" fill="#007AFF" />
        <rect x="12" y="16" width="6" height="2" rx="1" fill="#007AFF" opacity="0.6" />
        <rect x="12" y="20" width="7" height="2" rx="1" fill="#007AFF" opacity="0.6" />
      </svg>
    ),
    title: 'Block Architecture',
    description:
      'Content is structured as JSON data, not raw HTML. Parse, store, and render anywhere with ease.',
  },
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#5856D6" fillOpacity="0.1" />
        <path
          d="M16 6l-8 4.67v9.66L16 25l8-4.67V10.67L16 6z"
          stroke="#5856D6"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M12 14l4 2 4-2M16 16v5M16 16l-4-2M16 16l4-2"
          stroke="#5856D6"
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
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#AF52DE" fillOpacity="0.1" />
        <circle cx="16" cy="16" r="6" stroke="#AF52DE" strokeWidth="2" />
        <path d="M16 10V6M16 26v-4M10 16H6m20 0h-4" stroke="#AF52DE" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: 'Headless & Stylable',
    description:
      'Blok gives you the logic; you bring the UI. Compatible with Tailwind, Styled Components, or raw CSS.',
  },
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#FF9500" fillOpacity="0.1" />
        <path d="M8 12h16M8 16h12M8 20h16" stroke="#FF9500" strokeWidth="2" strokeLinecap="round" />
        <circle cx="26" cy="22" r="3" stroke="#FF9500" strokeWidth="2" />
      </svg>
    ),
    title: 'Drag & Drop',
    description: 'Native support for rearranging blocks with intuitive drag handles.',
  },
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#34C759" fillOpacity="0.1" />
        <path d="M16 8v16M8 16h16" stroke="#34C759" strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="8" r="2" fill="#34C759" />
        <circle cx="8" cy="16" r="2" fill="#34C759" />
        <circle cx="24" cy="16" r="2" fill="#34C759" />
        <circle cx="16" cy="24" r="2" fill="#34C759" />
      </svg>
    ),
    title: 'Extensible Plugin System',
    description: 'Create custom blocks for Kanbans, Embeds, Code Blocks, and more.',
  },
  {
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#FF3B30" fillOpacity="0.1" />
        <circle cx="16" cy="16" r="8" stroke="#FF3B30" strokeWidth="2" />
        <path d="M16 12v4M16 20h.01" stroke="#FF3B30" strokeWidth="2" strokeLinecap="round" />
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
