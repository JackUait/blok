import { FC, useRef, useEffect, useState, useCallback } from 'react';
import type { DemoConfig, BlockData } from './api-data';

export interface MiniBlokEditorProps {
  initialState?: DemoConfig['initialState'];
  onEditorReady?: (editor: unknown) => void;
}

// Extension interface for the container ref to expose methods
export interface MiniBlokEditorContainer extends HTMLDivElement {
  reset?: () => void;
  getEditor?: () => BlokEditorInstance | null;
}

interface BlokModule {
  Blok: new (config: unknown) => BlokEditorInstance;
  Header: unknown;
  Paragraph: unknown;
  List: unknown;
  Bold: unknown;
  Italic: unknown;
  Link: unknown;
}

interface BlokEditorInstance {
  destroy?: () => void;
  clear: () => Promise<void>;
  render: (data: { blocks: BlockData[] }) => Promise<void>;
  blocks: {
    getBlocksCount(): number;
  };
  [key: string]: unknown;
}

const DEFAULT_INITIAL_STATE = {
  blocks: [
    { id: '1', type: 'paragraph', data: { text: 'Hello World' } },
    { id: '2', type: 'paragraph', data: { text: 'Try the actions below!' } },
    { id: '3', type: 'header', data: { text: 'Getting Started', level: 2 } },
  ] as BlockData[],
};

/**
 * Mini Blok editor instance for API demos
 * Mounts a minimal editor with paragraph and header tools
 * Provides reset functionality and exposes editor instance
 */
export const MiniBlokEditor: FC<MiniBlokEditorProps> = ({
  initialState = DEFAULT_INITIAL_STATE,
  onEditorReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<BlokEditorInstance | null>(null);
  const initialStateRef = useRef(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep initialStateRef in sync
  initialStateRef.current = initialState;

  const initEditor = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      setLoading(true);
      setError(null);

      // Import the full bundle which includes all tools.
      // The Vite externalDistPlugin resolves /dist/ paths at runtime to the parent dist directory.
      // @ts-ignore - Module is resolved at runtime by Vite's externalDistPlugin
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const module = (await import('/dist/full.mjs')) as BlokModule;

      if (!containerRef.current) return;

      // Make tools available globally for the editor config
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).BlokHeader = module.Header;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).BlokParagraph = module.Paragraph;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).BlokList = module.List;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).BlokBold = module.Bold;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).BlokItalic = module.Italic;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).BlokLink = module.Link;

      // Create the editor
      const BlokClass = module.Blok;
      const editor = new BlokClass({
        holder: containerRef.current,
        tools: {
          header: {
            class: module.Header,
            config: {
              placeholder: 'Enter a header...',
              levels: [1, 2, 3, 4],
              defaultLevel: 2,
            },
            inlineToolbar: [],
          },
          paragraph: {
            class: module.Paragraph,
            inlineToolbar: [],
            config: {
              preserveBlank: true,
              placeholder: 'Type something...',
            },
          },
          list: {
            class: module.List,
            inlineToolbar: false,
            config: {
              defaultStyle: 'unordered',
            },
          },
        },
        data: {
          blocks: initialStateRef.current.blocks,
        },
        onReady: () => {
          setLoading(false);
          onEditorReady?.(editor);
        },
      });

      editorRef.current = editor;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setLoading(false);
    }
  }, [onEditorReady]);

  // Expose reset method through the ref (simulated - not using forwardRef for simplicity)
  const reset = useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.render({ blocks: initialStateRef.current.blocks });
    }
  }, []);

  // Attach reset to the DOM element for external access (simple approach for demos)
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as MiniBlokEditorContainer).reset = reset;
    }
  }, [reset]);

  // Expose getEditor through the DOM element
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as MiniBlokEditorContainer).getEditor = () =>
        editorRef.current;
    }
  });

  useEffect(() => {
    void initEditor();

    return () => {
      // Cleanup: destroy the editor instance
      const currentEditor = editorRef.current;
      if (currentEditor?.destroy) {
        currentEditor.destroy();
        editorRef.current = null;
      }
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="mini-blok-editor">
        <div className="mini-editor-error">
          <p>Failed to load editor</p>
          <p className="mini-editor-error-message">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mini-blok-editor">
      {loading && (
        <div className="mini-editor-placeholder">
          <div className="mini-editor-placeholder-content">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect
                width="32"
                height="32"
                rx="8"
                fill="url(#mini-placeholder-gradient)"
                opacity="0.1"
              />
              <path
                d="M8 12h16M8 16h12M8 20h8"
                stroke="url(#mini-placeholder-gradient)"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <defs>
                <linearGradient
                  id="mini-placeholder-gradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#007AFF" />
                  <stop offset="100%" stopColor="#5856D6" />
                </linearGradient>
              </defs>
            </svg>
            <p>Loading editor…</p>
          </div>
        </div>
      )}
    </div>
  );
};
