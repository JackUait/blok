import { Link } from "react-router-dom";
import { Logo } from "../common/Logo";

const BookIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
  </svg>
);

const CodeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const GitHubIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

const TelegramIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

const NpmIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331zM10.665 10H12v2.667h-1.335V10z" />
  </svg>
);

const MessageIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const HeartIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="footer-heart"
  >
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

export const Footer: React.FC = () => {
  return (
    <footer className="footer">
      {/* Decorative wave top */}
      <div className="footer-wave">
        <svg
          viewBox="0 0 1440 120"
          fill="none"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 120L48 108C96 96 192 72 288 66C384 60 480 72 576 78C672 84 768 84 864 78C960 72 1056 60 1152 60C1248 60 1344 72 1392 78L1440 84V120H1392C1344 120 1248 120 1152 120C1056 120 960 120 864 120C768 120 672 120 576 120C480 120 384 120 288 120C192 120 96 120 48 120H0Z"
            fill="url(#footerGradient)"
          />
          <defs>
            <linearGradient
              id="footerGradient"
              x1="0"
              y1="0"
              x2="1440"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--color-coral)" />
              <stop offset="0.5" stopColor="var(--color-orange)" />
              <stop offset="1" stopColor="var(--color-pink)" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Floating decorations */}
      <div className="footer-decorations">
        <div className="footer-shape footer-shape--1" />
        <div className="footer-shape footer-shape--2" />
        <div className="footer-shape footer-shape--3" />
      </div>

      <div className="container">
        <div className="footer-content">
          <div className="footer-brand" data-blok-testid="footer-brand">
            <div className="footer-logo">
              <div className="footer-mascot-wrapper">
              <img src="/mascot.png" alt="Blok mascot" className="footer-mascot" />
            </div>
            </div>
            <p className="footer-tagline">
              A friendly block-based rich text editor for modern applications.
              <br />
              <span className="footer-mascot-text">Built with <HeartIcon /></span>
            </p>
          </div>

          <div className="footer-links" data-blok-testid="footer-links">
            <div className="footer-column">
              <h4 className="footer-column-title">
                <BookIcon />
                <span>Documentation</span>
              </h4>
              <Link to="/#quick-start" className="footer-link">
                <span>Quick Start</span>
                <ArrowRightIcon />
              </Link>
              <Link to="/docs" className="footer-link">
                <span>API Reference</span>
                <ArrowRightIcon />
              </Link>
              <Link to="/migration" className="footer-link">
                <span>Migration Guide</span>
                <ArrowRightIcon />
              </Link>
            </div>
            <div className="footer-column">
              <h4 className="footer-column-title">
                <CodeIcon />
                <span>Resources</span>
              </h4>
              <a
                href="https://github.com/JackUait/blok"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
                data-blok-testid="github-link"
              >
                <span>GitHub</span>
                <ArrowRightIcon />
              </a>
              <a
                href="https://www.npmjs.com/package/@jackuait/blok"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>npm</span>
                <ArrowRightIcon />
              </a>
              <Link to="/demo" className="footer-link">
                <span>Live Demo</span>
                <ArrowRightIcon />
              </Link>
            </div>
            <div className="footer-column">
              <h4 className="footer-column-title">
                <MessageIcon />
                <span>Community</span>
              </h4>
              <a
                href="https://github.com/JackUait/blok/issues"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Issues</span>
                <ArrowRightIcon />
              </a>
              <a
                href="https://github.com/JackUait/blok/discussions"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Discussions</span>
                <ArrowRightIcon />
              </a>
              <a
                href="https://github.com/JackUait/blok/blob/master/CONTRIBUTING.md"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Contributing</span>
                <ArrowRightIcon />
              </a>
            </div>
          </div>
        </div>

        <div className="footer-bottom" data-blok-testid="footer-bottom">
          <div className="footer-bottom-content">
            <p className="footer-copyright">
              &copy; 2026 JackUait. Licensed under{" "}
              <a
                href="https://www.apache.org/licenses/LICENSE-2.0"
                target="_blank"
                rel="noopener noreferrer"
                data-blok-testid="license-link"
              >
                Apache 2.0
              </a>
            </p>
            <div className="footer-social">
              <a
                href="https://github.com/JackUait/blok"
                className="footer-social-link"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
              >
                <GitHubIcon />
              </a>
              <a
                href="https://t.me/that_ai_guy"
                className="footer-social-link"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
              >
                <TelegramIcon />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
