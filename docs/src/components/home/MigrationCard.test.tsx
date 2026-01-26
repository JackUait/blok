import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MigrationCard } from './MigrationCard';

// Mock Shiki to avoid async highlighting issues in tests
vi.mock('shiki', () => ({
  createHighlighter: vi.fn(() =>
    Promise.resolve({
      getLoadedLanguages: () => ['bash'],
      codeToHtml: (code: string) =>
        `<pre class="shiki"><code>${code}</code></pre>`,
      loadLanguage: vi.fn(),
    })
  ),
}));

describe('MigrationCard', () => {
  it('should render a section element', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByTestId('migration-section')).toBeInTheDocument();
  });

  it('should render the migration card', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByTestId('migration-card')).toBeInTheDocument();
  });

  it('should render the title', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByText('Migrating from EditorJS?')).toBeInTheDocument();
  });

  it('should render the description with drop-in replacement highlight', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByText('drop-in replacement')).toBeInTheDocument();
  });

  it('should render the migration badge', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByTestId('migration-badge')).toBeInTheDocument();
    expect(screen.getByText('Zero downtime migration')).toBeInTheDocument();
  });

  it('should render the migration code', async () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('npx -p @jackuait/blok migrate-from-editorjs ./src')).toBeInTheDocument();
    });
  });

  it('should render the View Migration Guide button', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /View Migration Guide/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/migration');
  });

  it('should render the View Codemod button', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /View Codemod/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/jackuait/blok/tree/master/codemod');
  });

  it('should have migration-content div', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByTestId('migration-content')).toBeInTheDocument();
  });

  it('should have migration-code element', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByTestId('migration-code')).toBeInTheDocument();
  });

  it('should have code element inside migration-code', async () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    // The code is rendered within a pre/code element inside migration-code
    const codeElement = screen.getByTestId('migration-code');
    expect(codeElement).toBeInTheDocument();
    // Verify the code text content is present (wait for async Shiki highlighting)
    await waitFor(() => {
      expect(codeElement.textContent).toContain('npx -p @jackuait/blok migrate-from-editorjs ./src');
    });
  });

  it('should have migration-title', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByTestId('migration-title')).toBeInTheDocument();
  });

  it('should have migration-description', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByTestId('migration-description')).toBeInTheDocument();
  });
});
