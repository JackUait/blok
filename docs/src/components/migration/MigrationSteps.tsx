import { CHANGE_ITEMS, CSS_MAPPINGS } from './migration-data';

export const MigrationSteps: React.FC = () => {
  return (
    <>
      <section className="migration-section">
        <h2 className="migration-section-title">What Gets Transformed</h2>
        <p className="migration-section-description">
          The codemod handles all the breaking changes automatically.
        </p>

        <div className="changes-grid">
          {CHANGE_ITEMS.map((item) => (
            <div key={item.title} className="change-card">
              <div className="change-card-header">
                <span className="change-card-icon">{item.icon}</span>
                <h3 className="change-card-title">{item.title}</h3>
              </div>
              <div className="change-card-content">
                <div className="diff-block">
                  <div className="diff-removed">
                    <span className="diff-marker">-</span>
                    <code>{item.removed}</code>
                  </div>
                  <div className="diff-added">
                    <span className="diff-marker">+</span>
                    <code>{item.added}</code>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="migration-section">
        <h2 className="migration-section-title">CSS Selector Reference</h2>
        <p className="migration-section-description">
          Reference for manually updating your CSS selectors.
        </p>

        <div className="reference-table-wrapper">
          <table className="migration-table reference-table">
            <thead>
              <tr>
                <th>EditorJS</th>
                <th>Blok</th>
              </tr>
            </thead>
            <tbody>
              {CSS_MAPPINGS.map((mapping, index) => (
                <tr key={index}>
                  <td>
                    <code>{mapping.editorjs}</code>
                  </td>
                  <td>
                    <code>{mapping.blok}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};
