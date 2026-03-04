import { useMemo } from "react";
import { CSS_MAPPINGS } from "./migration-data";
import { useI18n } from "../../contexts/I18nContext";

export const MigrationSteps: React.FC = () => {
  const { t } = useI18n();

  const changeItems = useMemo(() => [
    {
      icon: "1",
      title: t('migration.changeImports'),
      removed: "import EditorJS from '@editorjs/editorjs';",
      added: "import { Blok } from '@jackuait/blok';",
    },
    {
      icon: "2",
      title: t('migration.changeToolImports'),
      removed: "import Header from '@editorjs/header';",
      added: "import { Header } from '@jackuait/blok/tools';",
    },
    {
      icon: "3",
      title: t('migration.changeTypes'),
      removed: "import type { EditorConfig } from '@editorjs/editorjs';",
      added: "import type { BlokConfig } from '@jackuait/blok';",
    },
    {
      icon: "4",
      title: t('migration.changeCssSelectors'),
      removed: ".ce-block",
      added: "[data-blok-element]",
    },
    {
      icon: "5",
      title: t('migration.changeDefaultHolder'),
      removed: '<div id="editorjs"></div>',
      added: '<div id="blok"></div>',
    },
    {
      icon: "6",
      title: t('migration.changeDataAttributes'),
      removed: "data-id",
      added: "data-blok-id",
    },
  ], [t]);

  return (
    <>
      <section
        className="migration-section migration-section--surface"
        data-blok-testid="migration-section"
      >
        <div className="migration-section-header">
          <span className="migration-section-badge">
            {t('migration.step2Badge')}
          </span>
          <h2 className="migration-section-title">{t('migration.step2Title')}</h2>
          <p className="migration-section-description">
            {t('migration.step2Description')}
          </p>
        </div>

        <div className="changes-grid" data-blok-testid="changes-grid">
          {changeItems.map((item, index) => (
            <article
              key={item.icon}
              className="change-card"
              data-blok-testid="change-card"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="change-card-header">
                <span className="change-card-icon">{item.icon}</span>
                <h3 className="change-card-title">{item.title}</h3>
              </div>
              <div className="change-card-content">
                <div className="diff-block">
                  <div className="diff-removed">
                    <span className="diff-accent-bar" aria-hidden="true" />
                    <span className="diff-marker" aria-label={t('migration.removed')}>−</span>
                    <code>{item.removed}</code>
                  </div>
                  <div className="diff-added">
                    <span className="diff-accent-bar" aria-hidden="true" />
                    <span className="diff-marker" aria-label={t('migration.added')}>+</span>
                    <code>{item.added}</code>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="migration-section"
        data-blok-testid="css-reference-section"
      >
        <div className="migration-section-header">
          <span className="migration-section-badge">
            {t('migration.step3Badge')}
          </span>
          <h2 className="migration-section-title">{t('migration.step3Title')}</h2>
          <p className="migration-section-description">
            {t('migration.step3Description')}
          </p>
        </div>

        <div className="reference-card" data-blok-testid="migration-table">
          <div className="reference-card-header">
            <div className="reference-legend">
              <div className="reference-legend-item reference-legend-item--old">
                <span className="reference-legend-dot" />
                <span>{t('migration.heroFromEditorJS')}</span>
              </div>
              <svg className="reference-legend-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <div className="reference-legend-item reference-legend-item--new">
                <span className="reference-legend-dot" />
                <span>{t('migration.heroBlok')}</span>
              </div>
            </div>
            <span className="reference-count">{t('migration.selectorsCount').replace('{count}', String(CSS_MAPPINGS.length))}</span>
          </div>
          <div className="reference-mappings">
            {CSS_MAPPINGS.map((mapping, index) => (
              <div
                key={index}
                className="reference-mapping"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="reference-mapping-old">
                  <code>{mapping.editorjs}</code>
                </div>
                <div className="reference-mapping-connector">
                  <span className="reference-mapping-line" />
                  <svg className="reference-mapping-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
                <div className="reference-mapping-new">
                  <code>{mapping.blok}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
};
