import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MigrationCard } from './MigrationCard';
import { I18nProvider } from '../../contexts/I18nContext';

// Mock Shiki to avoid async highlighting issues in tests
vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn(() =>
    Promise.resolve({
      getLoadedLanguages: () => ['bash'],
      codeToHtml: (code: string) =>
        `<pre class="shiki"><code>${code}</code></pre>`,
    })
  ),
}));

vi.mock('shiki/engine/oniguruma', () => ({
  createOnigurumaEngine: vi.fn(() => Promise.resolve({})),
}));

// The oniguruma engine is stubbed above, so the 622 KB inlined wasm module it
// would otherwise pull into every test run is dead weight.
vi.mock('shiki/wasm', () => ({ default: {} }));

describe('MigrationCard', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('should render a section element', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('migration-section')).toBeInTheDocument();
  });

  it('should render the migration card', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('migration-card')).toBeInTheDocument();
  });

  it('should render the title', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByText('Migrate from EditorJS')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByText(/Our automated codemod handles most of the transition/)).toBeInTheDocument();
  });

  it('should not render the migration badge', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.queryByTestId('migration-badge')).not.toBeInTheDocument();
    expect(screen.queryByText('Zero downtime migration')).not.toBeInTheDocument();
  });

  it('should render the View Migration Guide button', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    const link = screen.getByRole('link', { name: /View Migration Guide/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/migration');
  });

  it('should render the View Codemod button', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    const link = screen.getByRole('link', { name: /View Codemod/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/jackuait/blok/tree/master/codemod');
  });

  it('should have migration-content div', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('migration-content')).toBeInTheDocument();
  });

  it('should have migration-title', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('migration-title')).toBeInTheDocument();
  });

  it('should have migration-description', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('migration-description')).toBeInTheDocument();
  });

  it('should render Russian strings when locale is ru', () => {
    render(
      <I18nProvider locale="ru">
        <MemoryRouter>
          <MigrationCard />
        </MemoryRouter>
      </I18nProvider>
    );
    expect(screen.getByText('Миграция с EditorJS')).toBeInTheDocument();
  });
});
