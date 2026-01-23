import { useState } from 'react';
import { CodeBlock } from '../common/CodeBlock';

type Tab = 'dry-run' | 'apply';

const DRY_RUN_CODE = 'npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run';
const APPLY_CODE = 'npx -p @jackuait/blok migrate-from-editorjs ./src';

const CODEMOD_OPTIONS = [
  { flag: '--dry-run', description: 'Preview changes without modifying files' },
  { flag: '--verbose', description: 'Show detailed output for each file processed' },
  { flag: '--use-library-i18n', description: "Use Blok's built-in translations (68 languages)" },
];

export const CodemodCard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dry-run');

  return (
    <div className="codemod-card">
      <div className="codemod-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path
            d="M24 4L6 12v14c0 9.5 7.7 18.4 18 20.5 10.3-2.1 18-11 18-20.5V12L24 4z"
            stroke="url(#codemod-gradient)"
            strokeWidth="2"
            fill="none"
          />
          <path
            d="M18 24l6 6 10-10"
            stroke="url(#codemod-gradient)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <defs>
            <linearGradient id="codemod-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: '#34C759' }} />
              <stop offset="100%" style={{ stopColor: '#30D158' }} />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h2 className="codemod-title">Automated Codemod</h2>
      <p className="codemod-description">
        The fastest way to migrate is using our automated codemod. It handles imports, selectors,
        types, and configuration.
      </p>

      <div className="codemod-tabs">
        <button
          className={`codemod-tab ${activeTab === 'dry-run' ? 'active' : ''}`}
          onClick={() => setActiveTab('dry-run')}
          type="button"
        >
          Dry Run
        </button>
        <button
          className={`codemod-tab ${activeTab === 'apply' ? 'active' : ''}`}
          onClick={() => setActiveTab('apply')}
          type="button"
        >
          Apply
        </button>
      </div>

      <div className="codemod-content">
        <div className={`codemod-panel ${activeTab === 'dry-run' ? 'active' : ''}`}>
          <p className="codemod-panel-label">Preview what will change (recommended first)</p>
          <CodeBlock code={DRY_RUN_CODE} language="bash" />
        </div>
        <div className={`codemod-panel ${activeTab === 'apply' ? 'active' : ''}`}>
          <p className="codemod-panel-label">Apply the changes</p>
          <CodeBlock code={APPLY_CODE} language="bash" />
        </div>
      </div>

      <div className="codemod-options">
        <h4 className="codemod-options-title">Options</h4>
        <table className="migration-table">
          <thead>
            <tr>
              <th>Flag</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {CODEMOD_OPTIONS.map((option) => (
              <tr key={option.flag}>
                <td>
                  <code>{option.flag}</code>
                </td>
                <td>{option.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
