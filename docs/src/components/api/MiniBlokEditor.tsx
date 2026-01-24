import type { FC } from 'react';
import { useRef, useEffect, useState, useCallback } from 'react';
import type { DemoConfig, BlockData } from './api-data';
import type { BlokEditorInstance, BlokModule } from '@/types/blok';

// Extend Window interface globally for tool class assignments
declare global {
  interface Window {
    BlokHeader: unknown;
    BlokParagraph: unknown;
    BlokList: unknown;
    BlokBold: unknown;
    BlokItalic: unknown;
    BlokLink: unknown;
  }
}

export interface MiniBlokEditorProps {
  initialState?: DemoConfig['initialState'];
  onEditorReady?: (editor: BlokEditorInstance) => void;
}

// Extension interface for the container ref to expose methods
export interface MiniBlokEditorContainer extends HTMLDivElement {
  reset?: () => void;
  getEditor?: () => BlokEditorInstance | null;
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
      // @ts-expect-error - Module path is resolved at runtime by Vite's externalDistPlugin, not TypeScript.
      // Type safety is ensured by the BlokModule cast which matches the runtime module structure.
      const module = (await import('/dist/full.mjs')) as BlokModule;

      if (!containerRef.current) return;

      // Make tools available globally for the editor config
      // This is required for the editor to find the tool classes
      window.BlokHeader = module.Header;
      window.BlokParagraph = module.Paragraph;
      window.BlokList = module.List;
      window.BlokBold = module.Bold;
      window.BlokItalic = module.Italic;
      window.BlokLink = module.Link;

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
      void editor.render({ blocks: initialStateRef.current.blocks });
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
    // Only run on mount - intentionally omit initEditor from deps to prevent re-initialization
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
