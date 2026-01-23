import { Link } from 'react-router-dom';
import { Logo } from '../common/Logo';

export const Footer: React.FC = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="footer-logo">
              <Logo size={24} />
              <span>Blok</span>
            </div>
            <p className="footer-tagline">Block-based rich text editor for modern applications.</p>
          </div>
          <div className="footer-links">
            <div className="footer-column">
              <h4 className="footer-column-title">Documentation</h4>
              <Link to="/#quick-start" className="footer-link">
                Quick Start
              </Link>
              <Link to="/#api" className="footer-link">
                API Reference
              </Link>
              <Link to="/migration" className="footer-link">
                Migration Guide
              </Link>
            </div>
            <div className="footer-column">
              <h4 className="footer-column-title">Resources</h4>
              <a
                href="https://github.com/JackUait/blok"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                href="https://www.npmjs.com/package/@jackuait/blok"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                npm
              </a>
              <Link to="/demo" className="footer-link">
                Examples
              </Link>
            </div>
            <div className="footer-column">
              <h4 className="footer-column-title">Community</h4>
              <a
                href="https://github.com/JackUait/blok/issues"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Issues
              </a>
              <a
                href="https://github.com/JackUait/blok/discussions"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Discussions
              </a>
              <a
                href="https://github.com/JackUait/blok/blob/master/CONTRIBUTING.md"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Contributing
              </a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>
            &copy; 2025 JackUait. Licensed under{' '}
            <a
              href="https://www.apache.org/licenses/LICENSE-2.0"
              target="_blank"
              rel="noopener noreferrer"
            >
              Apache 2.0
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
};
