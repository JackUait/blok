import { useState } from "react";
import { CodeBlock } from "../common/CodeBlock";

type Tab = "dry-run" | "apply";

const DRY_RUN_CODE =
  "npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run";
const APPLY_CODE = "npx -p @jackuait/blok migrate-from-editorjs ./src";

const CODEMOD_OPTIONS = [
  { 
    flag: "--dry-run", 
    description: "Preview changes without modifying files",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  },
  {
    flag: "--verbose",
    description: "Show detailed output for each file processed",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    )
  },
  {
    flag: "--use-library-i18n",
    description: "Use Blok's built-in translations (68 languages)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    )
  },
];

export const CodemodCard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>("dry-run");

  return (
    <div className="codemod-card" data-blok-testid="codemod-card">
      {/* Background decorations */}
      <div className="codemod-card-bg">
        <div className="codemod-card-glow" />
        <div className="codemod-card-pattern" />
      </div>
      
      {/* Floating particles */}
      <div className="codemod-particles">
        <span className="codemod-particle codemod-particle-1" />
        <span className="codemod-particle codemod-particle-2" />
        <span className="codemod-particle codemod-particle-3" />
        <span className="codemod-particle codemod-particle-4" />
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
            {/* Orbiting elements */}
            <div className="codemod-orbit">
              <span className="codemod-orbit-dot codemod-orbit-dot-1" />
              <span className="codemod-orbit-dot codemod-orbit-dot-2" />
              <span className="codemod-orbit-dot codemod-orbit-dot-3" />
            </div>
          </div>
          <div className="codemod-header-text">
            <div className="codemod-badge">
              <span className="codemod-badge-dot" />
              Automated
            </div>
            <h2 className="codemod-title">Codemod</h2>
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
            <span className="codemod-tab-text">Preview</span>
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
            <span className="codemod-tab-text">Apply</span>
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
                Preview what will change <span className="codemod-panel-hint">(recommended first)</span>
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
              <p className="codemod-panel-label">Apply the changes to your files</p>
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
              Options
            </h4>
            <span className="codemod-options-count">{CODEMOD_OPTIONS.length}</span>
          </div>
          <div className="codemod-options-list">
            {CODEMOD_OPTIONS.map((option, index) => (
              <div 
                key={option.flag} 
                className="codemod-option-item"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="codemod-option-icon">
                  {option.icon}
                </div>
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
