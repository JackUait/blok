import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitForElementToBeRemoved, within } from '@testing-library/react';
import { renderToPipeableStream } from 'react-dom/server';
import { PassThrough } from 'node:stream';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import { I18nProvider } from '../contexts/I18nContext';

// This page renders CodeBlock several times over; stub the highlighter so the
// oniguruma wasm and eight grammar modules stay out of the run.
vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn(() =>
    Promise.resolve({
      getLoadedLanguages: () => ['bash', 'typescript', 'tsx', 'vue', 'html'],
      codeToHtml: (code: string) => `<pre class="shiki"><code>${code}</code></pre>`,
    })
  ),
}));

vi.mock('shiki/engine/oniguruma', () => ({
  createOnigurumaEngine: vi.fn(() => Promise.resolve({})),
}));

vi.mock('shiki/wasm', () => ({ default: {} }));

/** The whole streamed document, deferred Suspense segments included. */
const renderToStream = (element: React.ReactElement): Promise<string> =>
  new Promise((resolve, reject) => {
    let html = '';
    const sink = new PassThrough();
    sink.on('data', (chunk: Buffer) => {
      html += chunk.toString();
    });
    sink.on('end', () => resolve(html));
    const { pipe } = renderToPipeableStream(element, {
      onAllReady: () => pipe(sink),
      onError: reject,
    });
  });

describe('HomePage', () => {
  it('should render the Nav component', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });

  it('should render the Footer component', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const footer = screen.getByTestId('footer-brand');
    expect(footer).toBeInTheDocument();
  });

  it('should render the Hero section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const heroContent = screen.getByTestId('hero-content');
    expect(heroContent).toBeInTheDocument();
  });

  it('should render the Features section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    const features = within(main).getByText(/built for developers/i);
    expect(features).toBeInTheDocument();
  });

  it('should render the framework integration cards', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(within(main).getByTestId('frameworks-section')).toBeInTheDocument();
    expect(within(main).getAllByTestId('framework-card')).toHaveLength(5);
  });

  it('should render the "Why Blok" comparison table', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(within(main).getByTestId('why-blok-section')).toBeInTheDocument();
    expect(within(main).getByRole('table')).toBeInTheDocument();
  });

  it('should render the MigrationCard section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const migration = screen.getByTestId('migration-section');
    expect(migration).toBeInTheDocument();
  });

  it('should render a main element', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('should have navigation links', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    // Primary site nav plus the Airbnb-style category bar are both landmarks
    const navs = screen.getAllByRole('navigation');
    expect(navs.length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole('navigation', { name: /browse the documentation/i })
    ).toBeInTheDocument();
  });

  it('should render the landing view without a panel placeholder', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('home-panel-loading')).not.toBeInTheDocument();
  });

  // The prerender is the whole point of this page: `/` and `/ru` are the two
  // highest-value URLs, and a Suspense boundary around the landing content
  // pushed all of it into a `<div hidden>` that only JavaScript un-hides —
  // React defers any boundary larger than progressiveChunkSize (12.8 KB) into a
  // late segment, whether or not it ever suspends. `renderToString` cannot see
  // this (it renders in one chunk); the prerender streams, so the test must too.
  it('renders the landing view into the streamed HTML, not behind a Suspense boundary', async () => {
    const html = await renderToStream(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(html).toContain('id="features"');
    expect(html).not.toContain('home-panel-loading');
    expect(html).not.toContain('<div hidden');
    expect(html).not.toContain('<template id="B:0"');
  });

  it.each(['playground', 'migration', 'changelog'])(
    'should load the %s panel lazily instead of bundling it with the landing view',
    async (view) => {
      render(
        <MemoryRouter initialEntries={[`/?view=${view}`]}>
          <I18nProvider>
            <HomePage />
          </I18nProvider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('home-panel-loading')).toBeInTheDocument();
      await waitForElementToBeRemoved(
        () => screen.queryByTestId('home-panel-loading'),
        // The demo panel pulls in the editor bundle; 1s is not enough to
        // transform it on a cold module graph.
        { timeout: 5000 }
      );
    }
  );
});
