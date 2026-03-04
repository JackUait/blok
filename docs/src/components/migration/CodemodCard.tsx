import { useState, useMemo } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";

type Tab = "dry-run" | "apply";

const DRY_RUN_CODE =
  "npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run";
const APPLY_CODE = "npx -p @jackuait/blok migrate-from-editorjs ./src";

export const CodemodCard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>("dry-run");
  const { t } = useI18n();

  const codemodOptions = useMemo(() => [
    {
      flag: "--dry-run",
      description: t('migration.codemodDryRunDescription'),
    },
    {
      flag: "--verbose",
      description: t('migration.codemodVerboseDescription'),
    },
    {
      flag: "--use-library-i18n",
      description: t('migration.codemodI18nDescription'),
    },
  ], [t]);

  return (
    <div className="codemod-card" data-blok-testid="codemod-card">
      {/* Background decoration */}
      <div className="codemod-card-bg">
        <div className="codemod-card-pattern" />
      </div>
      
      <div className="codemod-card-content">
        <div className="codemod-header">
          <div className="codemod-icon-wrapper">
            <div className="codemod-icon" data-blok-testid="codemod-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
          </div>
          <div className="codemod-header-text">
            <h2 className="codemod-title">{t('migration.codemodTitle')}</h2>
          </div>
        </div>
        
        <div className="codemod-tabs" data-blok-testid="codemod-tabs">
          <div className="codemod-tabs-track" />
          <button
            className={`codemod-tab ${activeTab === "dry-run" ? "active" : ""}`}
            onClick={() => setActiveTab("dry-run")}
            type="button"
            data-blok-testid="codemod-tab-dry-run"
          >
            <span className="codemod-tab-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <span className="codemod-tab-text">{t('migration.codemodPreviewTab')}</span>
          </button>
          <button
            className={`codemod-tab ${activeTab === "apply" ? "active" : ""}`}
            onClick={() => setActiveTab("apply")}
            type="button"
            data-blok-testid="codemod-tab-apply"
          >
            <span className="codemod-tab-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </span>
            <span className="codemod-tab-text">{t('migration.codemodApplyTab')}</span>
          </button>
        </div>

        <div className="codemod-content" data-blok-testid="codemod-content">
          <div
            className={`codemod-panel ${activeTab === "dry-run" ? "active" : ""}`}
            data-blok-testid="codemod-panel-dry-run"
          >
            <div className="codemod-panel-header">
              <span className="codemod-panel-indicator codemod-panel-indicator--preview" />
              <p className="codemod-panel-label">
                {t('migration.codemodPreviewLabel')} <span className="codemod-panel-hint">{t('migration.codemodPreviewHint')}</span>
              </p>
            </div>
            <CodeBlock code={DRY_RUN_CODE} language="bash" />
          </div>
          <div
            className={`codemod-panel ${activeTab === "apply" ? "active" : ""}`}
            data-blok-testid="codemod-panel-apply"
          >
            <div className="codemod-panel-header">
              <span className="codemod-panel-indicator codemod-panel-indicator--apply" />
              <p className="codemod-panel-label">{t('migration.codemodApplyLabel')}</p>
            </div>
            <CodeBlock code={APPLY_CODE} language="bash" />
          </div>
        </div>

        <div className="codemod-options" data-blok-testid="codemod-options">
          <div className="codemod-options-header">
            <h4
              className="codemod-options-title"
              data-blok-testid="codemod-options-title"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              {t('migration.codemodOptionsTitle')}
            </h4>
          </div>
          <div className="codemod-options-list">
            {codemodOptions.map((option, index) => (
              <div 
                key={option.flag} 
                className="codemod-option-item"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="codemod-option-content">
                  <code className="codemod-option-flag">{option.flag}</code>
                  <span className="codemod-option-desc">{option.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
