import { Link } from "react-router-dom";

interface ApiMethod {
  name: string;
  returnType: string;
  description: string;
}

interface ApiCard {
  title: string;
  methods: ApiMethod[];
}

const API_DATA: ApiCard[] = [
  {
    title: "Core Methods",
    methods: [
      {
        name: "save()",
        returnType: "Promise<OutputData>",
        description: "Extract content as JSON",
      },
      {
        name: "render(data)",
        returnType: "Promise<void>",
        description: "Render from JSON data",
      },
      {
        name: "focus()",
        returnType: "boolean",
        description: "Set cursor focus",
      },
      { name: "clear()", returnType: "void", description: "Clear all blocks" },
    ],
  },
  {
    title: "Blocks API",
    methods: [
      {
        name: "blocks.delete()",
        returnType: "Promise<void>",
        description: "Remove specified block",
      },
      {
        name: "blocks.insert()",
        returnType: "Promise<BlockAPI>",
        description: "Insert new block",
      },
      {
        name: "blocks.move()",
        returnType: "Promise<void>",
        description: "Move block to new index",
      },
      {
        name: "blocks.update()",
        returnType: "Promise<void>",
        description: "Update block data",
      },
    ],
  },
  {
    title: "Events",
    methods: [
      {
        name: "on(event, fn)",
        returnType: "void",
        description: "Subscribe to events",
      },
      {
        name: "off(event, fn)",
        returnType: "void",
        description: "Unsubscribe from events",
      },
      {
        name: "emit(event, data)",
        returnType: "void",
        description: "Emit custom events",
      },
    ],
  },
];

export const ApiPreview: React.FC = () => {
  return (
    <section className="api" id="api" data-blok-testid="api-preview-section">
      <div className="container">
        <div className="section-header">
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
          {API_DATA.map((card) => (
            <div
              key={card.title}
              className="api-card"
              data-blok-testid={`api-card-${card.title.toLowerCase().replace(" ", "-")}`}
            >
              <div
                className="api-card-header"
                data-blok-testid="api-card-header"
              >
                <h3 className="api-card-title">{card.title}</h3>
              </div>
              <div
                className="api-card-content"
                data-blok-testid="api-card-content"
              >
                {card.methods.map((method) => (
                  <div
                    key={method.name}
                    className="api-method"
                    data-blok-testid="api-method"
                  >
                    <span className="api-method-name">{method.name}</span>
                    <span className="api-method-return">
                      {method.returnType}
                    </span>
                    <p className="api-method-description">
                      {method.description}
                    </p>
                  </div>
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
