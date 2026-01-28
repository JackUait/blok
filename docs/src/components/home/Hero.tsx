import { Link } from 'react-router-dom';
import { use3DTilt } from '../../hooks/use3DTilt';
import { WaveDivider } from '../common/WaveDivider';

export const Hero: React.FC = () => {
  const mascotTilt = use3DTilt({
    maxTilt: 20,
    scale: 1.08,
    transitionSpeed: 500,
  });

  const handleScrollToQuickStart = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    const target = document.getElementById('quick-start');
    target?.scrollIntoView({ behavior: 'auto' });
  };

  return (
    <section className="hero">
      <div className="hero-bg">
        <div className="hero-blur hero-blur-1"></div>
        <div className="hero-blur hero-blur-2"></div>
        <div className="hero-blur hero-blur-3"></div>
      </div>
      <div className="hero-container">
        <div className="hero-content" data-blok-testid="hero-content">
          <p className="hero-eyebrow">Open-Source Editor</p>
          <h1 className="hero-title">
            Build beautiful
            <br />
            <span className="hero-title-gradient">block-based editors</span>
          </h1>
          <p className="hero-description">
            A production-ready, extensible rich text editor that brings Notion-like
            block-based editing to your app — customizable, themeable, and battle-tested.
          </p>
          <div className="hero-actions">
            <a
              href="#quick-start"
              className="btn btn-primary"
              onClick={handleScrollToQuickStart}
            >
              Get Started
            </a>
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
              Try it out
            </Link>
          </div>
        </div>
        <div className="hero-demo" data-blok-testid="hero-demo">
          <div
            ref={mascotTilt.ref}
            className={`hero-mascot hero-mascot-3d ${mascotTilt.isHovered ? 'hero-mascot-hovered' : ''}`}
            onMouseMove={mascotTilt.onMouseMove}
            onMouseEnter={mascotTilt.onMouseEnter}
            onMouseLeave={mascotTilt.onMouseLeave}
            style={mascotTilt.style}
          >
            <img
              src="/mascot.png"
              alt="Blok mascot - a friendly orange character with pink yarn"
              className="hero-mascot-image"
            />
            {/* Floating shadow that moves with tilt */}
            <div className="hero-mascot-shadow" aria-hidden="true" />
          </div>
        </div>
      </div>
      <WaveDivider
        variant="soft"
        fillColor="var(--color-wave-fill)"
        height={120}
        position="bottom"
      />
    </section>
  );
};
