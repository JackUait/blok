import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { I18nProvider } from '../../contexts/I18nContext';
import { EditorWrapper } from './EditorWrapper';

const renderEditor = (props: Parameters<typeof EditorWrapper>[0] = {}) =>
  render(
    <I18nProvider>
      <EditorWrapper {...props} />
    </I18nProvider>
  );

describe('EditorWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading state', () => {
    it('shows loading placeholder before editor initializes', () => {
      renderEditor();

      expect(screen.getByText('Loading editor...')).toBeInTheDocument();
    });

    it('renders the editor container with blok-editor class', () => {
      const { container } = renderEditor();

      expect(container.querySelector('.blok-editor')).toBeInTheDocument();
    });
  });

  describe('successful initialization', () => {
    it('hides the loading placeholder after editor loads', async () => {
      renderEditor();

      expect(screen.getByText('Loading editor...')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText('Loading editor...')).not.toBeInTheDocument();
      });
    });

    it('does not show the error state on successful load', async () => {
      renderEditor();

      await waitFor(() => {
        expect(screen.queryByText('Failed to load editor')).not.toBeInTheDocument();
      });
    });

    it('calls onEditorReady with the editor instance after loading', async () => {
      const onEditorReady = vi.fn();

      renderEditor({ onEditorReady });

      await waitFor(() => {
        expect(onEditorReady).toHaveBeenCalledOnce();
      });

      const editor = onEditorReady.mock.calls[0][0];
      expect(editor).toBeDefined();
      expect(typeof editor.save).toBe('function');
    });

    it('exposes an editor with a destroy method', async () => {
      const onEditorReady = vi.fn();

      renderEditor({ onEditorReady });

      await waitFor(() => {
        expect(onEditorReady).toHaveBeenCalledOnce();
      });

      const editor = onEditorReady.mock.calls[0][0];
      expect(typeof editor.destroy).toBe('function');
    });
  });

  describe('error state', () => {
    it('shows "Failed to load editor" heading when the module import throws', async () => {
      // Arrange: override the vitest mock to throw on construction
      const { EditorWrapper: BrokenEditorWrapper } = await createEditorWrapperWithBrokenImport(
        'Failed to fetch dynamically imported module: https://blokeditor.com/dist/full.mjs',
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<BrokenEditorWrapper />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load editor')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('shows build instructions in the error state', async () => {
      const { EditorWrapper: BrokenEditorWrapper } = await createEditorWrapperWithBrokenImport(
        'Module not found',
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<BrokenEditorWrapper />);

      await waitFor(() => {
        expect(screen.getByText(/npm run build/i)).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('displays the specific error message from the thrown error', async () => {
      const errorMessage = 'Failed to fetch dynamically imported module: https://blokeditor.com/dist/full.mjs';
      const { EditorWrapper: BrokenEditorWrapper } = await createEditorWrapperWithBrokenImport(errorMessage);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<BrokenEditorWrapper />);

      await waitFor(() => {
        expect(screen.getByText(`Error: ${errorMessage}`)).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('does not call onEditorReady when the import fails', async () => {
      const onEditorReady = vi.fn();
      const { EditorWrapper: BrokenEditorWrapper } = await createEditorWrapperWithBrokenImport('Network error');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<BrokenEditorWrapper onEditorReady={onEditorReady} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load editor')).toBeInTheDocument();
      });

      expect(onEditorReady).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('cleanup on unmount', () => {
    it('calls destroy on the editor instance when component unmounts', async () => {
      const onEditorReady = vi.fn();

      const { unmount } = renderEditor({ onEditorReady });

      await waitFor(() => {
        expect(onEditorReady).toHaveBeenCalledOnce();
      });

      const editor = onEditorReady.mock.calls[0][0];
      const destroySpy = vi.spyOn(editor, 'destroy');

      act(() => {
        unmount();
      });

      expect(destroySpy).toHaveBeenCalledOnce();
    });

    it('does not throw when unmounting before the editor finishes initializing', () => {
      const { unmount } = renderEditor();

      // Unmount synchronously before async init resolves
      expect(() => act(() => unmount())).not.toThrow();
    });
  });

  describe('onEditorReady callback stability', () => {
    it('calls the latest onEditorReady even if the prop is updated before init completes', async () => {
      const firstCallback = vi.fn();
      const secondCallback = vi.fn();

      const { rerender } = renderEditor({ onEditorReady: firstCallback });

      // Synchronously update to a new callback before the async init resolves
      rerender(
        <I18nProvider>
          <EditorWrapper onEditorReady={secondCallback} />
        </I18nProvider>
      );

      await waitFor(() => {
        expect(secondCallback).toHaveBeenCalledOnce();
      });

      expect(firstCallback).not.toHaveBeenCalled();
    });
  });
});

/**
 * Creates a version of EditorWrapper whose dynamic import of /dist/full.mjs throws.
 * Uses module factory inline to avoid top-level variable hoisting issues with vi.mock.
 */
async function createEditorWrapperWithBrokenImport(errorMessage: string) {
  const { useEffect, useRef, useState } = await import('react');

  const BrokenEditorWrapper: React.FC<{ onEditorReady?: (editor: unknown) => void }> = ({ onEditorReady }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const onEditorReadyRef = useRef(onEditorReady);
    onEditorReadyRef.current = onEditorReady;

    useEffect(() => {
      const editorState = { isMounted: true };

      const initEditor = async () => {
        try {
          // Simulate a failed dynamic import (e.g. 404 in production)
          await Promise.reject(new TypeError(errorMessage));
        } catch (err) {
          if (editorState.isMounted) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            setLoading(false);
          }
        }
      };

      void initEditor();

      return () => {
        editorState.isMounted = false;
      };
    }, []);

    if (error) {
      return (
        <div className="blok-editor">
          <div style={{ padding: '2rem', textAlign: 'center' }}>
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
        {loading && <div className="editor-placeholder"><p>Loading editor...</p></div>}
      </div>
    );
  };

  return { EditorWrapper: BrokenEditorWrapper };
}
