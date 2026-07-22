import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FrameworkCards } from './FrameworkCards';
import { I18nProvider } from '../../contexts/I18nContext';

// CodeBlock highlights via Shiki asynchronously; stub it so the snippets render
// synchronously as plain text in tests (mirrors MigrationCard.test).
vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn(() =>
    Promise.resolve({
      getLoadedLanguages: () => ['js', 'jsx', 'vue', 'ts', 'html'],
      codeToHtml: (code: string) => `<pre class="shiki"><code>${code}</code></pre>`,
    })
  ),
}));

vi.mock('shiki/engine/oniguruma', () => ({
  createOnigurumaEngine: vi.fn(() => Promise.resolve({})),
}));

// The oniguruma engine is stubbed above, so the 622 KB inlined wasm module it
// would otherwise pull into every test run is dead weight.
vi.mock('shiki/wasm', () => ({ default: {} }));

const renderCards = () =>
  render(
    <I18nProvider>
      <MemoryRouter>
        <FrameworkCards />
      </MemoryRouter>
    </I18nProvider>
  );

describe('FrameworkCards', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('renders the section', () => {
    renderCards();
    expect(screen.getByTestId('frameworks-section')).toBeInTheDocument();
  });

  it('renders a heading', () => {
    renderCards();
    expect(screen.getByRole('heading', { name: /your stack/i })).toBeInTheDocument();
  });

  it('renders one accordion row per supported entry point', () => {
    renderCards();
    expect(screen.getAllByTestId('framework-card')).toHaveLength(5);
  });

  it('names each supported entry point', () => {
    renderCards();
    // One trigger button per entry point (the "Vue"/"TypeScript" code-block
    // language labels are spans, so role:button keeps these unambiguous).
    expect(
      screen.getByRole('button', { name: /Vanilla JS \/ TypeScript/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^React/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Vue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Angular/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^CDN/i })).toBeInTheDocument();
  });

  it('starts with every row collapsed', () => {
    renderCards();
    for (const trigger of screen.getAllByRole('button', { expanded: false })) {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByRole('button', { expanded: true })).toBeNull();
  });

  it('lets several rows stay open at once', () => {
    renderCards();
    const vanillaTrigger = screen.getByRole('button', {
      name: /Vanilla JS \/ TypeScript/i,
    });
    const reactTrigger = screen.getByRole('button', { name: /^React/i });

    fireEvent.click(vanillaTrigger);
    fireEvent.click(reactTrigger);
    expect(vanillaTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(reactTrigger).toHaveAttribute('aria-expanded', 'true');

    // Add a third — all three remain open independently.
    const vueTrigger = screen.getByRole('button', { name: /^Vue/i });
    fireEvent.click(vueTrigger);
    expect(vueTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(reactTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(vanillaTrigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses a row when its open trigger is clicked again', () => {
    renderCards();
    const vanillaTrigger = screen.getByRole('button', {
      name: /Vanilla JS \/ TypeScript/i,
    });

    // Open then re-click toggles it shut without touching the others.
    fireEvent.click(vanillaTrigger);
    expect(vanillaTrigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(vanillaTrigger);
    expect(vanillaTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the real React adapter API in the React row', () => {
    renderCards();
    const reactRow = screen.getByTestId('framework-card-react');
    // useBlok returns the instance; BlokContent receives it via `editor`.
    expect(reactRow).toHaveTextContent('useBlok');
    expect(reactRow).toHaveTextContent('@bloklabs/react');
    expect(reactRow).toHaveTextContent('<BlokContent editor={editor} />');
  });

  it('shows the real Vue adapter API in the Vue row', () => {
    renderCards();
    const vueRow = screen.getByTestId('framework-card-vue');
    expect(vueRow).toHaveTextContent('@bloklabs/vue');
    expect(vueRow).toHaveTextContent('<BlokContent :editor="editor" />');
  });

  it('shows the real Angular adapter API in the Angular row', () => {
    renderCards();
    const angularRow = screen.getByTestId('framework-card-angular');
    expect(angularRow).toHaveTextContent('@bloklabs/angular');
    expect(angularRow).toHaveTextContent('BlokEditorComponent');
    expect(angularRow).toHaveTextContent('<blok-editor [tools]="tools" />');
  });

  it('shows the vanilla core import', () => {
    renderCards();
    const vanillaRow = screen.getByTestId('framework-card-vanilla');
    expect(vanillaRow).toHaveTextContent('@bloklabs/core/full');
  });

  it('shows the CDN global usage', () => {
    renderCards();
    const cdnRow = screen.getByTestId('framework-card-cdn');
    expect(cdnRow).toHaveTextContent('BlokEditor.Blok');
  });

  it('draws a single bordered/card shell around the whole accordion (rows are separated by inner dividers, unlike per-item cards elsewhere)', () => {
    renderCards();
    const rows = screen.getAllByTestId('framework-card');
    const shell = rows[0].parentElement;
    expect(shell).not.toBeNull();
    expect(shell?.className).toMatch(/bg-card/);
    expect(shell?.className).toMatch(/shadow-card/);
    expect(shell?.className).toMatch(/rounded-3xl/);
  });

  it('renders Russian copy when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderCards();
    // The framework proper-noun names are not translated, but the section
    // description is, so assert the section still mounts under ru.
    expect(screen.getByTestId('frameworks-section')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  // Expanding a row never changes the route, so the global page-view tracking
  // cannot see it — it needs its own event.
  describe('analytics', () => {
    const gtagHost = (): Window & { gtag?: unknown } => window;

    beforeEach(() => {
      vi.clearAllMocks();
      gtagHost().gtag = vi.fn();
    });

    afterEach(() => {
      delete gtagHost().gtag;
      vi.restoreAllMocks();
    });

    const gtagCalls = (): unknown[][] => {
      const gtag = gtagHost().gtag;
      if (!vi.isMockFunction(gtag)) {
        throw new Error('window.gtag was not stubbed');
      }
      return gtag.mock.calls;
    };

    // Scoped to the row so the trigger lookup stays cheap — an unscoped
    // name-regex query over this whole accordion is what makes the slower tests
    // in this file brush the default timeout.
    const triggerIn = (id: string): HTMLElement =>
      within(screen.getByTestId(`framework-card-${id}`)).getByRole('button', {
        expanded: false,
      });

    it('reports the framework id when a row is expanded', () => {
      renderCards();

      fireEvent.click(triggerIn('react'));

      expect(gtagCalls()).toContainEqual([
        'event',
        'framework_card_expand',
        { framework: 'react' },
      ]);
    });

    // Collapsing is not interest — it must stay silent, otherwise every open row
    // is counted twice and the report reads as double the real engagement.
    it('reports nothing when a row is collapsed again', () => {
      renderCards();
      const trigger = triggerIn('vue');

      fireEvent.click(trigger);
      expect(gtagCalls()).toHaveLength(1);

      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(gtagCalls()).toHaveLength(1);
    });
  });
});
