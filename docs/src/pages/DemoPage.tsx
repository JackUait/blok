import { useState, useCallback, useRef } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { EditorWrapper } from '../components/demo/EditorWrapper';
import { OutputPanel } from '../components/demo/OutputPanel';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/demo.css';

interface BlokEditor {
  save: () => Promise<unknown>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  destroy?: () => void;
}

export const DemoPage: React.FC = () => {
  const [showOutput, setShowOutput] = useState(false);
  const [output, setOutput] = useState<string>('Click "Get JSON" to see the output');
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
      setOutput('Editor cleared');
    }
  }, []);

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
            <span className="demo-live-badge">Interactive Demo</span>
            <h1 className="demo-title">
              Try the <span className="demo-title-gradient">Editor</span>
            </h1>
            <p className="demo-subtitle">
              A fully interactive editor running right here in your browser.
              Type <code className="inline-code">/</code> for commands, drag blocks to reorder, or select text to format.
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
                  Blok Editor
                </div>
                <div className="demo-chrome-actions">
                  <button
                    className="demo-action-btn"
                    onClick={handleUndo}
                    title="Undo (Ctrl+Z)"
                    aria-label="Undo"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7v6h6" />
                      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                    </svg>
                  </button>
                  <button
                    className="demo-action-btn"
                    onClick={handleRedo}
                    title="Redo (Ctrl+Shift+Z)"
                    aria-label="Redo"
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
                    title="Get JSON output"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span>Get JSON</span>
                  </button>
                  <button
                    className="demo-action-btn demo-action-btn--danger"
                    onClick={handleClear}
                    title="Clear editor"
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
                    JSON Output
                  </div>
                  <button
                    className="demo-close-btn"
                    onClick={() => setShowOutput(false)}
                    title="Close output panel"
                    aria-label="Close output panel"
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
              <span>Open command menu</span>
            </div>
            <div className="demo-tip">
              <kbd>Tab</kbd>
              <span>Indent list item</span>
            </div>
            <div className="demo-tip">
              <kbd>Ctrl</kbd><span>+</span><kbd>Z</kbd>
              <span>Undo</span>
            </div>
            <div className="demo-tip">
              <kbd>Ctrl</kbd><span>+</span><kbd>B</kbd>
              <span>Bold text</span>
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
                <strong>Instant Feedback</strong>
                <p>Everything happens locally in your browser. No server roundtrips, just pure performance.</p>
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
                <strong>Clean JSON Output</strong>
                <p>Content is stored as structured JSON blocks. Parse, validate, and store anywhere.</p>
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
                <strong>Block-Based Architecture</strong>
                <p>Create custom block types with simple JavaScript classes. Fully extensible.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};
