import { Link } from "react-router-dom";
import { CodeBlock } from "../common/CodeBlock";

const MIGRATION_COMMAND = "npx -p @jackuait/blok migrate-from-editorjs ./src";

export const MigrationCard: React.FC = () => {
  return (
    <section className="migration" data-blok-testid="migration-section">
      <div className="container">
        <div className="migration-card" data-blok-testid="migration-card">
          {/* Decorative background elements */}
          <div className="migration-bg-grid" aria-hidden="true" />
          <div className="migration-bg-orb migration-bg-orb--1" aria-hidden="true" />
          <div className="migration-bg-orb migration-bg-orb--2" aria-hidden="true" />
          <div className="migration-bg-glow" aria-hidden="true" />
          
          <div className="migration-layout migration-layout--centered" data-blok-testid="migration-content">
            <div className="migration-content">
              <div className="migration-badge" data-blok-testid="migration-badge">
                <span className="migration-badge-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
                  </svg>
                </span>
                Zero downtime migration
              </div>
              
              <h2 className="migration-title" data-blok-testid="migration-title">
                Migrate from EditorJS
              </h2>
              
              <p className="migration-description" data-blok-testid="migration-description">
                Already using EditorJS? Our automated codemod handles most of the 
                transition — just run it, review the changes, and ship.
              </p>
              
              <div className="migration-code-wrapper" data-blok-testid="migration-code">
                <CodeBlock code={MIGRATION_COMMAND} language="bash" />
              </div>
              
              <div className="migration-actions">
                <Link to="/migration" className="migration-btn migration-btn--primary">
                  View Migration Guide
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
                <a 
                  href="https://github.com/jackuait/blok/tree/master/codemod" 
                  className="migration-btn migration-btn--secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" fill="currentColor" />
                  </svg>
                  View Codemod
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
