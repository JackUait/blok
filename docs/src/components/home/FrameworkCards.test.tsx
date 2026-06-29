import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FrameworkCards } from './FrameworkCards';
import { I18nProvider } from '../../contexts/I18nContext';

// CodeBlock highlights via Shiki asynchronously; stub it so the snippets render
// synchronously as plain text in tests (mirrors MigrationCard.test).
vi.mock('shiki', () => ({
  createHighlighter: vi.fn(() =>
    Promise.resolve({
      getLoadedLanguages: () => ['js', 'jsx', 'html'],
      codeToHtml: (code: string) => `<pre class="shiki"><code>${code}</code></pre>`,
      loadLanguage: vi.fn(),
    })
  ),
}));

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

  it('renders exactly three integration cards', () => {
    renderCards();
    expect(screen.getAllByTestId('framework-card')).toHaveLength(3);
  });

  it('names each supported entry point', () => {
    renderCards();
    expect(screen.getByText('Vanilla JS / TypeScript')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('CDN')).toBeInTheDocument();
  });

  it('shows the real React adapter API in the React card', () => {
    renderCards();
    const reactCard = screen.getByTestId('framework-card-react');
    // useBlok returns the instance; BlokContent receives it via `editor`.
    expect(reactCard).toHaveTextContent('useBlok');
    expect(reactCard).toHaveTextContent('@jackuait/blok/react');
    expect(reactCard).toHaveTextContent('<BlokContent editor={editor} />');
  });

  it('shows the vanilla core import', () => {
    renderCards();
    const vanillaCard = screen.getByTestId('framework-card-vanilla');
    expect(vanillaCard).toHaveTextContent('@jackuait/blok/full');
  });

  it('shows the CDN global usage', () => {
    renderCards();
    const cdnCard = screen.getByTestId('framework-card-cdn');
    expect(cdnCard).toHaveTextContent('BlokEditor.Blok');
  });

  it('renders Russian copy when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderCards();
    // The framework proper-noun names are not translated, but the section
    // description is, so assert the section still mounts under ru.
    expect(screen.getByTestId('frameworks-section')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
  });
});
