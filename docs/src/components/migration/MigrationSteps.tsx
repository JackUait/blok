import { CHANGE_ITEMS, CSS_MAPPINGS } from "./migration-data";

export const MigrationSteps: React.FC = () => {
  return (
    <>
      <section
        className="migration-section migration-section--surface"
        data-blok-testid="migration-section"
      >
        <div className="migration-section-header">
          <span className="migration-section-badge">
            Step 2
          </span>
          <h2 className="migration-section-title">What Gets Transformed</h2>
          <p className="migration-section-description">
            The codemod handles all the breaking changes automatically.
          </p>
        </div>

        <div className="changes-grid" data-blok-testid="changes-grid">
          {CHANGE_ITEMS.map((item, index) => (
            <article
              key={item.title}
              className="change-card"
              data-blok-testid="change-card"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="change-card-header">
                <span className="change-card-icon">{item.icon}</span>
                <h3 className="change-card-title">{item.title}</h3>
              </div>
              <div className="change-card-content">
                <div className="diff-block">
                  <div className="diff-removed">
                    <span className="diff-accent-bar" aria-hidden="true" />
                    <span className="diff-marker" aria-label="Removed">−</span>
                    <code>{item.removed}</code>
                  </div>
                  <div className="diff-added">
                    <span className="diff-accent-bar" aria-hidden="true" />
                    <span className="diff-marker" aria-label="Added">+</span>
                    <code>{item.added}</code>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="migration-section"
        data-blok-testid="css-reference-section"
      >
        <div className="migration-section-header">
          <span className="migration-section-badge">
            Step 3
          </span>
          <h2 className="migration-section-title">CSS Selector Reference</h2>
          <p className="migration-section-description">
            Reference for manually updating your CSS selectors.
          </p>
        </div>

        <div className="reference-card" data-blok-testid="migration-table">
          <div className="reference-card-header">
            <div className="reference-legend">
              <div className="reference-legend-item reference-legend-item--old">
                <span className="reference-legend-dot" />
                <span>EditorJS</span>
              </div>
              <svg className="reference-legend-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <div className="reference-legend-item reference-legend-item--new">
                <span className="reference-legend-dot" />
                <span>Blok</span>
              </div>
            </div>
            <span className="reference-count">{CSS_MAPPINGS.length} selectors</span>
          </div>
          <div className="reference-mappings">
            {CSS_MAPPINGS.map((mapping, index) => (
              <div
                key={index}
                className="reference-mapping"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="reference-mapping-old">
                  <code>{mapping.editorjs}</code>
                </div>
                <div className="reference-mapping-connector">
                  <span className="reference-mapping-line" />
                  <svg className="reference-mapping-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
                <div className="reference-mapping-new">
                  <code>{mapping.blok}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
};
