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
          <p className="hero-eyebrow">Open Source Editor</p>
          <h1 className="hero-title">
            Build beautiful
            <br />
            <span className="hero-title-gradient">block-based editors</span>
          </h1>
          <p className="hero-description">
            Blok is a headless, highly extensible rich text editor built for developers who need to
            implement a Notion-like editing experience without building it from scratch.
          </p>
          <div className="hero-actions">
            <Link to="/#quick-start" className="btn btn-primary">
              Get Started
            </Link>
            <Link to="/demo" className="btn btn-secondary">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Try Demo
            </Link>
          </div>
        </div>
        <div className="hero-demo" data-hero-demo>
          <div className="hero-mascot">
            <img
              src="/mascot.png"
              alt="Blok mascot - a friendly orange character with pink yarn"
              className="hero-mascot-image"
            />
          </div>
        </div>
      </div>
    </section>
  );
};
