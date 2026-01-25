import { Nav } from '../components/layout/Nav';
import { EditorWrapper } from '../components/demo/EditorWrapper';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/demo.css';

export const DemoPage: React.FC = () => {
  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="demo-page">
        <div className="demo-bg">
          <div className="demo-blur demo-blur-1" />
          <div className="demo-blur demo-blur-2" />
        </div>

        <div className="demo-container">
          <div className="demo-header">
            <div className="demo-badge">
              <span className="demo-badge-dot" />
              <span className="demo-badge-text">Live Demo</span>
            </div>
            <h1 className="demo-title">
              Experience Blok
            </h1>
            <p className="demo-subtitle">
              A fully functional editor running in your browser.
              <br />
              Type <code className="inline-code">/</code> for commands, drag blocks to reorder, or select text to format.
            </p>
          </div>

          <div className="editor-container">
            <EditorWrapper />
          </div>

          <div className="features-hint">
            <div className="hint-card" data-hint-card style={{ animationDelay: '0.1s' }}>
              <div className="hint-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <div className="hint-content">
                <strong>Real-time Editing</strong>
                <p>Everything happens instantly in your browser. No server roundtrips, just pure performance.</p>
              </div>
            </div>

            <div className="hint-card" data-hint-card style={{ animationDelay: '0.2s' }}>
              <div className="hint-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M12 18v-6" />
                  <path d="M9 15l3 3 3-3" />
                </svg>
              </div>
              <div className="hint-content">
                <strong>Clean JSON Output</strong>
                <p>Content is stored as structured JSON blocks, not messy HTML. Parse, validate, and store anywhere.</p>
              </div>
            </div>

            <div className="hint-card" data-hint-card style={{ animationDelay: '0.3s' }}>
              <div className="hint-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v6m0 6v6" />
                  <path d="M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24" />
                  <path d="M1 12h6m6 0h6" />
                  <path d="M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24" />
                </svg>
              </div>
              <div className="hint-content">
                <strong>Extensible Architecture</strong>
                <p>Create custom block types with simple JavaScript classes. Bring your own UI or use the defaults.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
};
