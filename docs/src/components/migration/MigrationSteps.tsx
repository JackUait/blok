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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10,9 9,9 8,9" />
            </svg>
            Transformations
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
                    <span className="diff-marker">−</span>
                    <code>{item.removed}</code>
                  </div>
                  <div className="diff-added">
                    <span className="diff-marker">+</span>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Reference
          </span>
          <h2 className="migration-section-title">CSS Selector Reference</h2>
          <p className="migration-section-description">
            Reference for manually updating your CSS selectors.
          </p>
        </div>

        <div className="reference-card">
          <div className="reference-table-wrapper">
            <table
              className="migration-table reference-table"
              data-blok-testid="migration-table"
            >
              <colgroup>
                <col style={{ width: '50%' }} />
                <col style={{ width: '50%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <span className="table-header-icon table-header-icon--old">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </span>
                    EditorJS
                  </th>
                  <th>
                    <span className="table-header-icon table-header-icon--new">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20,6 9,17 4,12" />
                      </svg>
                    </span>
                    Blok
                  </th>
                </tr>
              </thead>
              <tbody>
                {CSS_MAPPINGS.map((mapping, index) => (
                  <tr key={index}>
                    <td>
                      <code className="code-old">{mapping.editorjs}</code>
                    </td>
                    <td>
                      <code className="code-new">{mapping.blok}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
};
