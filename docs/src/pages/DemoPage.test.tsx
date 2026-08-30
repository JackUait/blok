import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
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
  // Mirrors the real instance: only save/clear/render/focus/on/off/emit are
  // installed on it, undo/redo live on the `history` namespace and return void.
  history: {
    undo: vi.fn(() => undefined),
    redo: vi.fn(() => undefined),
  },
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

type TestLocale = 'en' | 'ru';

const demoPath = (locale: TestLocale): string => (locale === 'ru' ? '/ru/demo' : '/demo');

const demoTree = (locale: TestLocale) => (
  <MemoryRouter initialEntries={[demoPath(locale)]}>
    <I18nProvider locale={locale}>
      <DemoPage />
    </I18nProvider>
  </MemoryRouter>
);

function renderDemoPage(locale: TestLocale = 'en') {
  return render(demoTree(locale));
}

/** The markup the prerender build writes into each locale's index.html. */
const prerenderDemoPage = (locale: TestLocale = 'en'): string =>
  renderToStaticMarkup(demoTree(locale));

/** `Typo` glues short words with U+00A0 — compare against plain spaces. */
const plain = (text: string): string => text.replace(/\u00A0/g, ' ');

/** byRole's `name` is matched verbatim, so the glued spaces have to come out. */
const named = (text: string) => (name: string): boolean => plain(name) === text;

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

    it('names the page with exactly one visible h1', () => {
      renderDemoPage();

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0].className).not.toMatch(/\bsr-only\b/);
      expect(plain(headings[0].textContent ?? '')).toContain('Try the Editor');
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

  describe('static content (what the prerendered page says with JS off)', () => {
    it('introduces the playground with the badge and subtitle', () => {
      renderDemoPage();

      expect(screen.getByText('Interactive Demo')).toBeInTheDocument();
      expect(
        screen.getByText(/A fully interactive editor running right here in your browser/)
      ).toBeInTheDocument();
    });

    it('lists what a reader can try here', () => {
      renderDemoPage();

      const section = within(screen.getByRole('region', { name: named('What you can try here') }));
      expect(section.getByText('Slash commands')).toBeInTheDocument();
      expect(section.getByText('Drag and drop')).toBeInTheDocument();
      expect(section.getByText('Tables and columns')).toBeInTheDocument();
      expect(section.getByText('Read-only mode')).toBeInTheDocument();
      expect(section.getByText('JSON output')).toBeInTheDocument();
      expect(section.getByText(/open the command menu/)).toBeInTheDocument();
    });

    it('links onward to the docs pages a reader needs next', () => {
      renderDemoPage();

      const section = within(screen.getByRole('region', { name: named('Where to go next') }));
      expect(section.getByRole('link', { name: /Quick Start/ })).toHaveAttribute(
        'href',
        '/docs/quick-start/'
      );
      expect(section.getByRole('link', { name: /Configuration/ })).toHaveAttribute(
        'href',
        '/docs/config/'
      );
      expect(section.getByRole('link', { name: /OutputData/ })).toHaveAttribute(
        'href',
        '/docs/output-data/'
      );
      expect(section.getByRole('link', { name: /Framework adapters/ })).toHaveAttribute(
        'href',
        '/docs/blok-editor/'
      );
    });

    it('carries the shortcut tips through to the standalone page', () => {
      renderDemoPage();

      expect(screen.getByText('Open command menu')).toBeInTheDocument();
      expect(screen.getByText('Instant Feedback')).toBeInTheDocument();
    });

    // React never reconciles <noscript> children on the client
    // (`shouldSetTextContent` short-circuits them), so this can only be asserted
    // on the server-rendered markup — which is what the build ships anyway.
    it('explains in <noscript> that the editor needs JavaScript, and links to the docs', () => {
      const markup = plain(prerenderDemoPage());
      const noscript = markup.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';

      expect(noscript).not.toBe('');
      expect(noscript).toContain('JavaScript is off');
      expect(noscript).toContain('so the playground cannot run without it');
      expect(noscript).toContain('href="/docs/"');
    });

    it('renders the Russian tree in Russian, with Russian-tree links', () => {
      renderDemoPage('ru');

      expect(plain(screen.getAllByRole('heading', { level: 1 })[0].textContent ?? '')).toContain(
        'Попробуйте'
      );
      expect(screen.getByText('Интерактивное демо')).toBeInTheDocument();
      const trySection = within(screen.getByRole('region', { name: named('Что можно попробовать') }));
      expect(trySection.getByText('Слэш-команды')).toBeInTheDocument();
      expect(trySection.getByText('Таблицы и колонки')).toBeInTheDocument();

      const nextSection = within(screen.getByRole('region', { name: named('Куда идти дальше') }));
      expect(nextSection.getByRole('link', { name: /Быстрый старт/ })).toHaveAttribute(
        'href',
        '/ru/docs/quick-start/'
      );

      expect(screen.queryByText('What you can try here')).not.toBeInTheDocument();
      expect(screen.queryByText('Interactive Demo')).not.toBeInTheDocument();
    });

    it('puts the Russian <noscript> copy in Russian too', () => {
      const markup = plain(prerenderDemoPage('ru'));
      const noscript = markup.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';

      expect(noscript).toContain('JavaScript отключён');
      expect(noscript).toContain('href="/ru/docs/"');
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

    it('tracks the undo control and drives it through the history namespace', () => {
      renderDemoContent();

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      expect(gtagCalls()).toContainEqual(['event', 'demo_action', { action: 'undo' }]);
      expect(editorStub.history.undo).toHaveBeenCalledTimes(1);
    });

    it('tracks the redo control and drives it through the history namespace', () => {
      renderDemoContent();

      fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

      expect(gtagCalls()).toContainEqual(['event', 'demo_action', { action: 'redo' }]);
      expect(editorStub.history.redo).toHaveBeenCalledTimes(1);
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
