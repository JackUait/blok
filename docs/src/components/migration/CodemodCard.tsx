import { useState } from "react";
import { CodeBlock } from "../common/CodeBlock";

type Tab = "dry-run" | "apply";

const DRY_RUN_CODE =
  "npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run";
const APPLY_CODE = "npx -p @jackuait/blok migrate-from-editorjs ./src";

const CODEMOD_OPTIONS = [
  { flag: "--dry-run", description: "Preview changes without modifying files" },
  {
    flag: "--verbose",
    description: "Show detailed output for each file processed",
  },
  {
    flag: "--use-library-i18n",
    description: "Use Blok's built-in translations (68 languages)",
  },
];

export const CodemodCard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>("dry-run");

  return (
    <div className="codemod-card" data-blok-testid="codemod-card">
      {/* Glow effect */}
      <div className="codemod-card-glow" />
      
      <div className="codemod-card-content">
        <div className="codemod-header">
          <div className="codemod-icon" data-blok-testid="codemod-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <div className="codemod-header-text">
            <h2 className="codemod-title">Automated Codemod</h2>
            <p className="codemod-subtitle">
              The fastest way to migrate your codebase
            </p>
          </div>
        </div>
        
        <p className="codemod-description">
          Our codemod handles imports, selectors, types, and configuration automatically.
          Run with <code>--dry-run</code> first to preview changes.
        </p>

        <div className="codemod-tabs" data-blok-testid="codemod-tabs">
          <button
            className={`codemod-tab ${activeTab === "dry-run" ? "active" : ""}`}
            onClick={() => setActiveTab("dry-run")}
            type="button"
            data-blok-testid="codemod-tab-dry-run"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Preview
          </button>
          <button
            className={`codemod-tab ${activeTab === "apply" ? "active" : ""}`}
            onClick={() => setActiveTab("apply")}
            type="button"
            data-blok-testid="codemod-tab-apply"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Apply
          </button>
        </div>

        <div className="codemod-content" data-blok-testid="codemod-content">
          <div
            className={`codemod-panel ${activeTab === "dry-run" ? "active" : ""}`}
            data-blok-testid="codemod-panel-dry-run"
          >
            <p className="codemod-panel-label">
              Preview what will change (recommended first)
            </p>
            <CodeBlock code={DRY_RUN_CODE} language="bash" />
          </div>
          <div
            className={`codemod-panel ${activeTab === "apply" ? "active" : ""}`}
            data-blok-testid="codemod-panel-apply"
          >
            <p className="codemod-panel-label">Apply the changes to your files</p>
            <CodeBlock code={APPLY_CODE} language="bash" />
          </div>
        </div>

        <div className="codemod-options" data-blok-testid="codemod-options">
          <h4
            className="codemod-options-title"
            data-blok-testid="codemod-options-title"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Options
          </h4>
          <div className="codemod-options-list">
            {CODEMOD_OPTIONS.map((option) => (
              <div key={option.flag} className="codemod-option-item">
                <code className="codemod-option-flag">{option.flag}</code>
                <span className="codemod-option-desc">{option.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
