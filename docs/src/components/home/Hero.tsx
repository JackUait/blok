import { Link } from 'react-router-dom';
import { useI18n } from '../../contexts/I18nContext';

export const Hero: React.FC = () => {
  const { t } = useI18n();

  const handleScrollToQuickStart = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    const target = document.getElementById('quick-start');
    target?.scrollIntoView({ behavior: 'auto' });
  };

  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden="true">
        <div className="hero-wash" />
        <div className="hero-grain" />
      </div>
      <div className="hero-container">
        <div className="hero-content" data-blok-testid="hero-content">
          <p className="hero-eyebrow">{t('home.hero.eyebrow')}</p>
          <h1 className="hero-title">
            {t('home.hero.title')}
            <br />
            <span className="hero-title-gradient">{t('home.hero.titleGradient')}</span>
          </h1>
          <p className="hero-description">
            {t('home.hero.description')}
          </p>
          <div className="hero-actions">
            <a
              href="#quick-start"
              className="btn btn-primary"
              onClick={handleScrollToQuickStart}
            >
              {t('home.hero.ctaGetStarted')}
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
              {t('home.hero.ctaTryItOut')}
            </Link>
          </div>
        </div>
        <div className="hero-demo" data-blok-testid="hero-demo">
          <div className="hero-stage">
            <div className="hero-stage-glow" aria-hidden="true" />
            <Link
              to="/demo"
              className="hero-mascot-card"
              aria-label={t('home.hero.mascotAriaLabel')}
            >
              <img
                src="/mascot.png"
                alt={t('home.hero.mascotAlt')}
                className="hero-mascot-image"
              />
              <span className="hero-mascot-chip">
                {t('home.hero.ctaTryItOut')}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </Link>
            <div className="hero-float hero-float--json" aria-hidden="true">
              <span className="hero-float-glyph">{'{ }'}</span>
              {t('home.hero.chipJson')}
            </div>
            <div className="hero-float hero-float--size" aria-hidden="true">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              {t('home.hero.chipSize')}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
