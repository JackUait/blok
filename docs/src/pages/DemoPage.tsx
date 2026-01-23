import { useState } from 'react';
import { Nav } from '../components/layout/Nav';
import { Toolbar } from '../components/demo/Toolbar';
import { EditorWrapper } from '../components/demo/EditorWrapper';
import { OutputPanel } from '../components/demo/OutputPanel';
import { Toast } from '../components/common/Toast';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/demo.css';

interface BlokEditor {
  save: () => Promise<unknown>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export const DemoPage: React.FC = () => {
  const [editor, setEditor] = useState<BlokEditor | null>(null);
  const [output, setOutput] = useState('Click "Save" to see the JSON output');
  const [toast, setToast] = useState({ visible: false, message: '' });

  const showToast = (message: string) => {
    setToast({ visible: true, message });
  };

  const handleSave = async () => {
    if (editor) {
      try {
        const data = await editor.save();
        setOutput(JSON.stringify(data, null, 2));
        showToast('Content saved!');
      } catch (err) {
        console.error('Save failed:', err);
        showToast('Failed to save');
      }
    }
  };

  const handleClear = async () => {
    if (editor) {
      try {
        await editor.clear();
        showToast('Editor cleared');
      } catch (err) {
        console.error('Clear failed:', err);
      }
    }
  };

  const handleUndo = async () => {
    if (editor) {
      try {
        await editor.undo();
      } catch (err) {
        console.error('Undo failed:', err);
      }
    }
  };

  const handleRedo = async () => {
    if (editor) {
      try {
        await editor.redo();
      } catch (err) {
        console.error('Redo failed:', err);
      }
    }
  };

  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="demo-page">
        <header className="demo-header">
          <div className="demo-header-content">
            <div className="demo-badge">
              <span className="demo-badge-dot"></span>
              <span className="demo-badge-text">Live Demo</span>
            </div>
            <h1 className="demo-title">Try Blok</h1>
            <p className="demo-subtitle">
              Experience the block-based editor. Type{' '}
              <code className="inline-code">/</code> for commands or use the toolbar.
            </p>
          </div>
        </header>

        <div className="editor-container">
          <Toolbar
            onUndo={handleUndo}
            onRedo={handleRedo}
            onSave={handleSave}
            onClear={handleClear}
          />
          <EditorWrapper onEditorReady={setEditor} />
        </div>

        <OutputPanel output={output} />

        <div className="features-hint">
          <div className="hint-card">
            <div className="hint-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </div>
            <div className="hint-content">
              <strong>Pro tip:</strong> Type <code>/</code> in an empty block to see available block
              types.
            </div>
          </div>
          <div className="hint-card">
            <div className="hint-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M15 3h6v6M10 14L21 3M15 21h6v-6M10 10l11 11" />
              </svg>
            </div>
            <div className="hint-content">
              Drag blocks using the <strong>⋮⋮</strong> handle to reorder.
            </div>
          </div>
          <div className="hint-card">
            <div className="hint-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <div className="hint-content">
              Select text to format using the inline toolbar.
            </div>
          </div>
        </div>
      </main>
      <Toast
        visible={toast.visible}
        message={toast.message}
        onVisibleChange={(visible) => setToast((prev) => ({ ...prev, visible }))}
      />
    </>
  );
};
