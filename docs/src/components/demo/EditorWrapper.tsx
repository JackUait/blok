import { useEffect, useRef, useState } from 'react';

interface BlokEditor {
  save: () => Promise<unknown>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface BlokModule {
  Blok: new (config: unknown) => BlokEditor;
  Header: unknown;
  Paragraph: unknown;
  List: unknown;
  Bold: unknown;
  Italic: unknown;
  Link: unknown;
}

export const EditorWrapper: React.FC<{
  onEditorReady: (editor: BlokEditor) => void;
}> = ({ onEditorReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let editor: BlokEditor | null = null;

    const initEditor = async () => {
      if (!containerRef.current) return;

      try {
        // Import the full bundle which includes all tools
        // @ts-ignore - Dynamic import of external Blok module
        const module = (await import('/dist/full.mjs')) as unknown as BlokModule;

        // Make tools available globally for the editor config
        (window as unknown as Record<string, unknown>).BlokHeader = module.Header;
        (window as unknown as Record<string, unknown>).BlokParagraph = module.Paragraph;
        (window as unknown as Record<string, unknown>).BlokList = module.List;
        (window as unknown as Record<string, unknown>).BlokBold = module.Bold;
        (window as unknown as Record<string, unknown>).BlokItalic = module.Italic;
        (window as unknown as Record<string, unknown>).BlokLink = module.Link;

        // Remove placeholder
        const placeholder = containerRef.current.querySelector('.editor-placeholder');
        if (placeholder) {
          placeholder.remove();
        }

        // Create the editor
        const BlokClass = module.Blok;
        editor = new BlokClass({
          holder: containerRef.current,
          tools: {
            header: {
              class: module.Header,
              config: {
                placeholder: 'Enter a header...',
                levels: [1, 2, 3, 4],
                defaultLevel: 2,
              },
              inlineToolbar: ['bold', 'italic', 'link'],
            },
            paragraph: {
              class: module.Paragraph,
              inlineToolbar: ['bold', 'italic', 'link'],
              config: {
                preserveBlank: true,
                placeholder: 'Type "/" for commands...',
              },
            },
            list: {
              class: module.List,
              inlineToolbar: true,
              config: {
                defaultStyle: 'unordered',
              },
            },
          },
          data: {
            blocks: [
              {
                id: 'welcome-block',
                type: 'header',
                data: {
                  text: 'Welcome to Blok',
                  level: 2,
                },
              },
              {
                id: 'intro-block',
                type: 'paragraph',
                data: {
                  text: 'This is a live demo of the Blok editor. Try typing <code>/</code> to see available commands, or select text to format it.',
                },
              },
              {
                id: 'features-list',
                type: 'list',
                data: {
                  style: 'unordered',
                  items: [
                    'Block-based architecture',
                    'Slash commands for quick formatting',
                    'Drag and drop to reorder blocks',
                    'Clean JSON output',
                  ],
                },
              },
            ],
          },
          onChange: () => {
            // Optional: Auto-save indicator
            console.log('Content changed');
          },
          onReady: () => {
            console.log('Blok editor is ready!');
          },
        });

        setLoading(false);
        onEditorReady(editor);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        setLoading(false);
      }
    };

    initEditor();

    return () => {
      // Cleanup would go here if the editor has a destroy method
    };
  }, [onEditorReady]);

  if (error) {
    return (
      <div className="blok-editor">
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--demo-text-muted, #666)',
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Failed to load editor</p>
          <p style={{ fontSize: 14 }}>
            Make sure the Blok editor is built with <code>npm run build</code>
          </p>
          <p style={{ fontSize: 12, marginTop: '1rem' }}>Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="blok-editor">
      {loading && (
        <div className="editor-placeholder">
          <div className="placeholder-content">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <rect
                width="64"
                height="64"
                rx="16"
                fill="url(#placeholder-gradient)"
                opacity="0.1"
              />
              <rect
                x="14"
                y="18"
                width="36"
                height="28"
                rx="6"
                stroke="url(#placeholder-gradient)"
                strokeWidth="2"
              />
              <rect x="18" y="24" width="16" height="2" rx="1" fill="#007AFF" />
              <rect x="18" y="30" width="12" height="2" rx="1" fill="#5856D6" />
              <defs>
                <linearGradient
                  id="placeholder-gradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" style={{ stopColor: '#007AFF' }} />
                  <stop offset="100%" style={{ stopColor: '#5856D6' }} />
                </linearGradient>
              </defs>
            </svg>
            <p>Loading editor...</p>
          </div>
        </div>
      )}
    </div>
  );
};
