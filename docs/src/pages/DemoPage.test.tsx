import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../contexts/I18nContext';
import { DemoPage, DemoContent } from './DemoPage';

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

/**
 * The real EditorWrapper cannot boot the editor under jsdom (it imports the
 * built /dist bundles), so it never reports readiness. This mock renders the
 * real component — every existing DOM assertion still holds — and additionally
 * hands the page a stub editor instance, which is what the analytics wiring
 * reacts to.
 */
const editorStub = vi.hoisted(() => ({
  save: vi.fn(async () => ({ blocks: [] })),
  clear: vi.fn(async () => undefined),
  undo: vi.fn(async () => undefined),
  redo: vi.fn(async () => undefined),
}));

vi.mock('../components/demo/EditorWrapper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/demo/EditorWrapper')>();
  const { useEffect } = await import('react');

  const EditorWrapper: typeof actual.EditorWrapper = (props) => {
    const { onEditorReady } = props;

    useEffect(() => {
      onEditorReady?.(editorStub);
    }, [onEditorReady]);

    return <actual.EditorWrapper {...props} />;
  };

  return { ...actual, EditorWrapper };
});

function renderDemoPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <DemoPage />
      </I18nProvider>
    </MemoryRouter>
  );
}

describe('DemoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (window as GtagWindow).gtag = vi.fn();
  });

  afterEach(() => {
    delete (window as GtagWindow).gtag;
    vi.restoreAllMocks();
  });

  describe('page structure', () => {
    it('renders navigation', () => {
      renderDemoPage();

      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('renders the header statically (not pinned to the viewport)', () => {
      renderDemoPage();

      const nav = screen.getByRole('navigation');
      expect(nav.className).toMatch(/\bstatic\b/);
      expect(nav.className).not.toMatch(/\bfixed\b/);
    });

    it('renders a main element', () => {
      renderDemoPage();

      expect(screen.getByRole('main')).toBeInTheDocument();
    });

    it('renders footer', () => {
      renderDemoPage();

      expect(screen.getByTestId('footer-brand')).toBeInTheDocument();
    });

    it('renders an sr-only heading for the page (a11y, not shown visually)', () => {
      renderDemoPage();

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('does not render the marketing badge/subtitle/hint content', () => {
      renderDemoPage();

      expect(screen.queryByText('Interactive Demo')).not.toBeInTheDocument();
      expect(screen.queryByText('Instant Feedback')).not.toBeInTheDocument();
      expect(screen.queryByText('Open command menu')).not.toBeInTheDocument();
    });

    it('renders the editor component', () => {
      const { container } = renderDemoPage();

      // EditorWrapper renders a .blok-editor container
      expect(container.querySelector('.blok-editor')).toBeInTheDocument();
    });

    it('does not put a max-width directly on the overflow-auto container', () => {
      renderDemoPage();

      // A block's +/drag-handle toolbar bleeds ~60px to the left of its content
      // column. A max-width applied to THIS element would also shrink its own
      // overflow-auto box, clipping that bleed. The centering max-width instead
      // lives on an inner div (see next test) with plenty of room to spare.
      const editorContainer = screen.getByTestId('demo-editor-container');
      expect(editorContainer.className).not.toMatch(/\bmax-w-\S+/);
    });

    it('centers the editor on the page via an inner max-width wrapper', () => {
      const { container } = renderDemoPage();

      const editor = container.querySelector('.blok-editor');
      const centeringWrapper = editor?.closest('.mx-auto[class*="max-w-"]');
      expect(centeringWrapper).toBeInTheDocument();
    });

    it('reserves generous horizontal padding so the block toolbar gutter is not clipped', () => {
      renderDemoPage();

      const editorContainer = screen.getByTestId('demo-editor-container');
      expect(editorContainer.className).toMatch(/\bsm:px-16\b/);
    });

    it('adds a gap between the header and the editor', () => {
      renderDemoPage();

      const editorContainer = screen.getByTestId('demo-editor-container');
      // A visible top gap below the static header — plain py-* (no explicit
      // top spacing) would read as flush against the header.
      expect(editorContainer.className).toMatch(/\bpt-(8|10|12)\b/);
    });
  });

  describe('no editor chrome', () => {
    it('does not render the editor toolbar card title', () => {
      renderDemoPage();

      expect(screen.queryByText('Blok Editor')).not.toBeInTheDocument();
    });

    it('does not render a Get JSON button', () => {
      renderDemoPage();

      expect(screen.queryByTitle('Get JSON output')).not.toBeInTheDocument();
    });

    it('does not render Undo/Redo buttons', () => {
      renderDemoPage();

      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Redo' })).not.toBeInTheDocument();
    });

    it('does not render a Clear (delete) button', () => {
      renderDemoPage();

      expect(screen.queryByTitle('Clear editor')).not.toBeInTheDocument();
    });

    it('does not render the JSON output panel', () => {
      renderDemoPage();

      expect(screen.queryByTestId('output-panel')).not.toBeInTheDocument();
    });
  });

  describe('settings panel', () => {
    it('renders a settings tab on the right edge', () => {
      renderDemoPage();

      expect(screen.getByRole('button', { name: 'Open editor settings' })).toBeInTheDocument();
    });

    it('opens the editor settings panel when the tab is clicked', () => {
      renderDemoPage();

      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));

      expect(screen.getByRole('heading', { name: 'Editor settings' })).toBeInTheDocument();
    });

    it('exposes the interesting editor settings as controls', () => {
      renderDemoPage();

      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));

      expect(screen.getByRole('switch', { name: 'Read-only mode' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Full' })).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Hide toolbar' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'First block placeholder' })).toBeInTheDocument();
    });

    it('restores saved editor settings from localStorage', () => {
      localStorage.setItem(
        'blok-docs-demo-editor-settings',
        JSON.stringify({ readOnly: true, width: 'full' })
      );

      renderDemoPage();
      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));

      expect(screen.getByRole('switch', { name: 'Read-only mode' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Full' })).toHaveAttribute('aria-checked', 'true');
    });

    it('persists setting changes to localStorage', () => {
      renderDemoPage();

      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Hide toolbar' }));

      const stored = JSON.parse(localStorage.getItem('blok-docs-demo-editor-settings') ?? '{}');
      expect(stored.hideToolbar).toBe(true);
    });

    it('switches the whole documentation theme from the panel', () => {
      renderDemoPage();

      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('re-aligns the editor content when alignment is changed in the panel', async () => {
      const { container } = renderDemoPage();

      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Center' }));

      await waitFor(() => {
        expect(container.querySelector('.blok-editor')).toHaveAttribute('data-blok-content-align', 'center');
      });
    });
  });

  describe('analytics', () => {
    const gtagCalls = (): unknown[][] => {
      const gtag = (window as GtagWindow).gtag;
      if (!vi.isMockFunction(gtag)) {
        throw new Error('window.gtag is not stubbed');
      }
      return gtag.mock.calls;
    };

    const renderDemoContent = () =>
      render(
        <MemoryRouter>
          <I18nProvider>
            <DemoContent />
          </I18nProvider>
        </MemoryRouter>
      );

    it('tracks demo_editor_ready once when the playground editor boots', () => {
      renderDemoPage();

      const readyEvents = gtagCalls().filter((call) => call[1] === 'demo_editor_ready');
      expect(readyEvents).toHaveLength(1);
      expect(readyEvents[0]).toEqual(['event', 'demo_editor_ready', {}]);
    });

    it('tracks the undo control', () => {
      renderDemoContent();

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      expect(gtagCalls()).toContainEqual(['event', 'demo_action', { action: 'undo' }]);
    });

    it('tracks the redo control', () => {
      renderDemoContent();

      fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

      expect(gtagCalls()).toContainEqual(['event', 'demo_action', { action: 'redo' }]);
    });

    it('tracks the Get JSON control', () => {
      renderDemoContent();

      fireEvent.click(screen.getByTitle('Get JSON output'));

      expect(gtagCalls()).toContainEqual(['event', 'demo_action', { action: 'save' }]);
    });

    it('tracks the clear control', () => {
      renderDemoContent();

      fireEvent.click(screen.getByTitle('Clear editor'));

      expect(gtagCalls()).toContainEqual(['event', 'demo_action', { action: 'clear' }]);
    });

    it('tracks closing the JSON output panel', async () => {
      renderDemoContent();

      fireEvent.click(screen.getByTitle('Get JSON output'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Close output panel' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Close output panel' }));

      expect(gtagCalls()).toContainEqual(['event', 'demo_action', { action: 'close_output' }]);
    });

    it('tracks settings-panel changes with the setting that changed', () => {
      renderDemoPage();

      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Read-only mode' }));

      expect(gtagCalls()).toContainEqual([
        'event',
        'demo_action',
        { action: 'change_setting', setting: 'readOnly', value: 'true' },
      ]);
    });

    it('omits free-text setting values from the tracked payload', () => {
      renderDemoPage();

      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'First block placeholder' }), {
        target: { value: 'Type here' },
      });

      expect(gtagCalls()).toContainEqual([
        'event',
        'demo_action',
        { action: 'change_setting', setting: 'placeholder' },
      ]);
    });

    it('does not fire a demo_action before any control is used', () => {
      renderDemoContent();

      expect(gtagCalls().filter((call) => call[1] === 'demo_action')).toHaveLength(0);
    });
  });

  describe('locale switching', () => {
    it('renders without crashing when locale is set to RU', () => {
      localStorage.setItem('blok-docs-locale', 'ru');
      renderDemoPage();

      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });
});
