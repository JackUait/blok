import { Link } from 'react-router-dom';

export const Hero: React.FC = () => {
  return (
    <section className="hero">
      <div className="hero-bg">
        <div className="hero-blur hero-blur-1"></div>
        <div className="hero-blur hero-blur-2"></div>
        <div className="hero-blur hero-blur-3"></div>
      </div>
      <div className="hero-container">
        <div className="hero-content" data-hero-content>
          <p className="hero-eyebrow">Documentation</p>
          <h1 className="hero-title">
            Beautiful block-based
            <br />
            <span className="hero-title-gradient">rich text editing</span>
          </h1>
          <p className="hero-description">
            Blok is a headless, highly extensible rich text editor built for developers who need to
            implement a Notion-like editing experience without building it from scratch.
          </p>
          <div className="hero-actions">
            <Link to="/#quick-start" className="btn btn-primary">
              Get Started
            </Link>
            <a
              href="https://github.com/JackUait/blok"
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
        <div className="hero-demo" data-hero-demo>
          <Link to="/demo" className="editor-mockup-link">
            <div className="editor-mockup">
              <div className="editor-header">
                <div className="editor-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <span className="editor-title">Untitled</span>
              </div>
              <div className="editor-content">
                <div className="editor-block editor-block-heading">
                  <h2>Welcome to Blok</h2>
                </div>
                <div className="editor-block">
                  <p>
                    A powerful block-based editor that treats every piece of content as an individual
                    unit.
                  </p>
                </div>
                <div className="editor-block">
                  <ul className="editor-list">
                    <li>Headless architecture</li>
                    <li>Slash commands</li>
                    <li>Drag & drop</li>
                  </ul>
                </div>
                <div className="editor-block">
                  <p>Start typing to see the magic happen...</p>
                </div>
              </div>
              <div className="editor-mockup-overlay">
                <div className="try-button">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>Try it live</span>
                </div>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
};
