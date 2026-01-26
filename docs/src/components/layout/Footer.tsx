import { Link } from "react-router-dom";
import { Logo } from "../common/Logo";

export const Footer: React.FC = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-brand" data-blok-testid="footer-brand">
            <div className="footer-logo">
              <Logo size={28} />
              <span>Blok</span>
            </div>
            <p className="footer-tagline">
              A friendly block-based rich text editor for modern applications.
              Built with love 🧡
            </p>
            <img
              src="/mascot.png"
              alt="Blok mascot"
              className="footer-mascot"
              style={{
                width: "80px",
                height: "auto",
                marginTop: "16px",
                opacity: 0.9,
                filter: "drop-shadow(0 4px 12px rgba(240, 123, 75, 0.2))",
              }}
            />
          </div>
          <div className="footer-links" data-blok-testid="footer-links">
            <div className="footer-column">
              <h4 className="footer-column-title">Documentation</h4>
              <Link to="/#quick-start" className="footer-link">
                Quick Start
              </Link>
              <Link to="/docs" className="footer-link">
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
                data-blok-testid="github-link"
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
                Live Demo
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
        <div className="footer-bottom" data-blok-testid="footer-bottom">
          <p>
            &copy; 2026 JackUait. Licensed under{" "}
            <a
              href="https://www.apache.org/licenses/LICENSE-2.0"
              target="_blank"
              rel="noopener noreferrer"
              data-blok-testid="license-link"
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
