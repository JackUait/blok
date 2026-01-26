import { Link } from "react-router-dom";

interface ApiMethod {
  name: string;
  description: string;
  /** Anchor ID for linking to the specific method in the docs */
  anchor: string;
}

interface ApiCard {
  title: string;
  icon: React.ReactNode;
  accentColor: string;
  docSection: string;
  methods: ApiMethod[];
}

const IconBolt: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IconBlocks: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const IconBroadcast: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </svg>
);

const API_DATA: ApiCard[] = [
  {
    title: "Core Methods",
    icon: <IconBolt />,
    accentColor: "coral",
    docSection: "core",
    methods: [
      {
        name: "save()",
        description: "Extract content as JSON",
        anchor: "core-save",
      },
      {
        name: "render(data)",
        description: "Render from JSON data",
        anchor: "core-render",
      },
      {
        name: "focus()",
        description: "Set cursor focus",
        anchor: "core-focus",
      },
      {
        name: "clear()",
        description: "Clear all blocks",
        anchor: "core-clear",
      },
    ],
  },
  {
    title: "Blocks API",
    icon: <IconBlocks />,
    accentColor: "green",
    docSection: "blocks-api",
    methods: [
      {
        name: "blocks.delete()",
        description: "Remove specified block",
        anchor: "blocks-api-blocks-delete",
      },
      {
        name: "blocks.insert()",
        description: "Insert new block",
        anchor: "blocks-api-blocks-insert",
      },
      {
        name: "blocks.move()",
        description: "Move block to new index",
        anchor: "blocks-api-blocks-move",
      },
      {
        name: "blocks.update()",
        description: "Update block data",
        anchor: "blocks-api-blocks-update",
      },
    ],
  },
  {
    title: "Events",
    icon: <IconBroadcast />,
    accentColor: "pink",
    docSection: "events-api",
    methods: [
      {
        name: "on(event, fn)",
        description: "Subscribe to events",
        anchor: "events-api-on",
      },
      {
        name: "off(event, fn)",
        description: "Unsubscribe from events",
        anchor: "events-api-off",
      },
      {
        name: "emit(event, data)",
        description: "Emit custom events",
        anchor: "events-api-emit",
      },
    ],
  },
];

export const ApiPreview: React.FC = () => {
  return (
    <section className="api" id="api" data-blok-testid="api-preview-section">
      <div className="container">
        <div className="section-header">
          <span className="section-eyebrow">Developer Experience</span>
          <h2 className="section-title">
            Powerful APIs
            <br />
            for every use case
          </h2>
          <p className="section-description">
            Access every aspect of the editor through our comprehensive API
            surface.
          </p>
        </div>
        <div className="api-grid" data-blok-testid="api-grid">
          {API_DATA.map((card, index) => (
            <div
              key={card.title}
              className={`api-card api-card--${card.accentColor}`}
              data-blok-testid={`api-card-${card.title.toLowerCase().replace(" ", "-")}`}
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div
                className="api-card-header"
                data-blok-testid="api-card-header"
              >
                <span className="api-card-icon">{card.icon}</span>
                <h3 className="api-card-title">{card.title}</h3>
              </div>
              <div
                className="api-card-content"
                data-blok-testid="api-card-content"
              >
                {card.methods.map((method) => (
                  <Link
                    key={method.name}
                    to={`/docs#${method.anchor}`}
                    className="api-method"
                    data-blok-testid="api-method"
                  >
                    <div className="api-method-signature">
                      <span className="api-method-name">{method.name}</span>
                    </div>
                    <p className="api-method-description">
                      {method.description}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="api-cta" data-blok-testid="api-cta">
          <Link to="/docs" className="btn btn-secondary">
            View Full API Reference
          </Link>
        </div>
      </div>
    </section>
  );
};
