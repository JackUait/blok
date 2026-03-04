import { useState, useCallback, useRef } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { EditorWrapper } from '../components/demo/EditorWrapper';
import { OutputPanel } from '../components/demo/OutputPanel';
import { NAV_LINKS } from '../utils/constants';
import { useI18n } from '../contexts/I18nContext';
import '../../assets/demo.css';

interface BlokEditor {
  save: () => Promise<unknown>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  destroy?: () => void;
}

export const DemoPage: React.FC = () => {
  const { t } = useI18n();
  const [showOutput, setShowOutput] = useState(false);
  const [output, setOutput] = useState<string>(() => t('demo.outputInitialMessage'));
  const editorRef = useRef<BlokEditor | null>(null);

  const handleEditorReady = useCallback((editor: BlokEditor) => {
    editorRef.current = editor;
  }, []);

  const handleSave = useCallback(async () => {
    if (editorRef.current) {
      const data = await editorRef.current.save();
      setOutput(JSON.stringify(data, null, 2));
      setShowOutput(true);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (editorRef.current) {
      await editorRef.current.clear();
      setOutput(t('demo.editorCleared'));
    }
  }, [t]);

  const handleUndo = useCallback(async () => {
    if (editorRef.current) {
      await editorRef.current.undo();
    }
  }, []);

  const handleRedo = useCallback(async () => {
    if (editorRef.current) {
      await editorRef.current.redo();
    }
  }, []);

  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="demo-page">
        <div className="demo-bg">
          <div className="demo-blur demo-blur-1" />
          <div className="demo-blur demo-blur-2" />
          <div className="demo-blur demo-blur-3" />
        </div>

        <div className="demo-container">
          <div className="demo-header">
            <span className="demo-live-badge">{t('demo.badge')}</span>
            <h1 className="demo-title">
              {t('demo.title')} <span className="demo-title-gradient">{t('demo.titleGradient')}</span>
            </h1>
            <p className="demo-subtitle">
              {t('demo.subtitle')}
              <code className="inline-code">{t('demo.subtitleCommand')}</code>
              {t('demo.subtitleRest')}
            </p>
          </div>

          <div className="demo-workspace">
            <div className={`demo-editor-panel ${showOutput ? 'demo-editor-panel--split' : ''}`}>
              <div className="demo-editor-chrome">
                <div className="demo-chrome-dots">
                  <span className="demo-chrome-dot demo-chrome-dot--red" />
                  <span className="demo-chrome-dot demo-chrome-dot--yellow" />
                  <span className="demo-chrome-dot demo-chrome-dot--green" />
                </div>
                <div className="demo-chrome-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  {t('demo.editorTitle')}
                </div>
                <div className="demo-chrome-actions">
                  <button
                    className="demo-action-btn"
                    onClick={handleUndo}
                    title={t('demo.undoTitle')}
                    aria-label={t('demo.undoAriaLabel')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7v6h6" />
                      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                    </svg>
                  </button>
                  <button
                    className="demo-action-btn"
                    onClick={handleRedo}
                    title={t('demo.redoTitle')}
                    aria-label={t('demo.redoAriaLabel')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 7v6h-6" />
                      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
                    </svg>
                  </button>
                  <div className="demo-action-divider" />
                  <button
                    className="demo-action-btn demo-action-btn--primary"
                    onClick={handleSave}
                    title={t('demo.getJsonTitle')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span>{t('demo.getJsonLabel')}</span>
                  </button>
                  <button
                    className="demo-action-btn demo-action-btn--danger"
                    onClick={handleClear}
                    title={t('demo.clearTitle')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="editor-container">
                <EditorWrapper onEditorReady={handleEditorReady} />
              </div>
            </div>

            {showOutput && (
              <div className="demo-output-panel">
                <div className="demo-output-chrome">
                  <div className="demo-chrome-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    {t('demo.jsonOutputTitle')}
                  </div>
                  <button
                    className="demo-close-btn"
                    onClick={() => setShowOutput(false)}
                    title={t('demo.closeOutputTitle')}
                    aria-label={t('demo.closeOutputAriaLabel')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <OutputPanel output={output} />
              </div>
            )}
          </div>

          <div className="demo-tips">
            <div className="demo-tip">
              <kbd>/</kbd>
              <span>{t('demo.tipOpenMenu')}</span>
            </div>
            <div className="demo-tip">
              <kbd>Tab</kbd>
              <span>{t('demo.tipIndentList')}</span>
            </div>
            <div className="demo-tip">
              <kbd>Ctrl</kbd><span>+</span><kbd>Z</kbd>
              <span>{t('demo.tipUndo')}</span>
            </div>
            <div className="demo-tip">
              <kbd>Ctrl</kbd><span>+</span><kbd>B</kbd>
              <span>{t('demo.tipBoldText')}</span>
            </div>
          </div>

          <div className="features-hint">
            <div className="hint-card" data-hint-card style={{ animationDelay: '0.1s' }}>
              <div className="hint-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div className="hint-content">
                <strong>{t('demo.hintInstantFeedbackTitle')}</strong>
                <p>{t('demo.hintInstantFeedbackDesc')}</p>
              </div>
            </div>

            <div className="hint-card" data-hint-card style={{ animationDelay: '0.2s' }}>
              <div className="hint-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <div className="hint-content">
                <strong>{t('demo.hintCleanJsonTitle')}</strong>
                <p>{t('demo.hintCleanJsonDesc')}</p>
              </div>
            </div>

            <div className="hint-card" data-hint-card style={{ animationDelay: '0.3s' }}>
              <div className="hint-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </div>
              <div className="hint-content">
                <strong>{t('demo.hintBlockArchTitle')}</strong>
                <p>{t('demo.hintBlockArchDesc')}</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};
