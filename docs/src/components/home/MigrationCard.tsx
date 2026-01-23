import { Link } from 'react-router-dom';

export const MigrationCard: React.FC = () => {
  return (
    <section className="migration">
      <div className="container">
        <div className="migration-card">
          <div className="migration-content">
            <div className="migration-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <path
                  d="M24 4L6 12v14c0 9.5 7.7 18.4 18 20.5 10.3-2.1 18-11 18-20.5V12L24 4z"
                  stroke="url(#migration-gradient)"
                  strokeWidth="2"
                  fill="none"
                />
                <path
                  d="M18 24l6 6 10-10"
                  stroke="url(#migration-gradient)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <defs>
                  <linearGradient id="migration-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style={{ stopColor: '#34C759' }} />
                    <stop offset="100%" style={{ stopColor: '#30D158' }} />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h2 className="migration-title">Migrating from EditorJS?</h2>
            <p className="migration-description">
              Blok is designed as a drop-in replacement. Use our automated codemod to switch in
              minutes, not hours.
            </p>
            <div className="migration-code">
              <pre>
                <code>npx -p @jackuait/blok migrate-from-editorjs ./src</code>
              </pre>
            </div>
            <Link to="/migration" className="btn btn-primary">
              View Migration Guide
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};
