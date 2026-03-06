import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CodeBlock } from './CodeBlock';
import { I18nProvider } from '../../contexts/I18nContext';

const {
  mockCodeToHtml,
  mockGetLoadedLanguages,
  mockLoadLanguage,
  mockCreateHighlighter,
} = vi.hoisted(() => {
  const mockCodeToHtml = vi.fn(
    (code: string) => `<pre class="shiki"><code>${code}</code></pre>`
  );
  const mockGetLoadedLanguages = vi.fn(() => ['bash', 'typescript']);
  const mockLoadLanguage = vi.fn(() => Promise.resolve());
  const mockCreateHighlighter = vi.fn(() =>
    Promise.resolve({
      codeToHtml: mockCodeToHtml,
      getLoadedLanguages: mockGetLoadedLanguages,
      loadLanguage: mockLoadLanguage,
    })
  );
  return {
    mockCodeToHtml,
    mockGetLoadedLanguages,
    mockLoadLanguage,
    mockCreateHighlighter,
  };
});

vi.mock('shiki', () => ({
  createHighlighter: mockCreateHighlighter,
}));

const renderWithI18n = (ui: React.ReactElement) =>
  render(<I18nProvider>{ui}</I18nProvider>);

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateHighlighter.mockResolvedValue({
      codeToHtml: mockCodeToHtml,
      getLoadedLanguages: mockGetLoadedLanguages,
      loadLanguage: mockLoadLanguage,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // This test must run first - before the highlighter singleton is populated
  it('calls createHighlighter with correct themes', async () => {
    renderWithI18n(<CodeBlock code="hello" language="bash" />);
    await waitFor(() => {
      expect(mockCreateHighlighter).toHaveBeenCalledWith(
        expect.objectContaining({
          themes: expect.arrayContaining(['vitesse-dark', 'one-light']),
        })
      );
    });
  });

  it('renders with initial plain-text fallback immediately', () => {
    renderWithI18n(<CodeBlock code="const x = 1;" language="typescript" />);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('renders highlighted code after shiki loads', async () => {
    renderWithI18n(<CodeBlock code="const x = 1;" language="typescript" />);
    await waitFor(() => {
      expect(mockCodeToHtml).toHaveBeenCalledWith(
        'const x = 1;',
        expect.objectContaining({ lang: 'typescript' })
      );
    });
  });

  it('displays the language label', () => {
    renderWithI18n(<CodeBlock code="echo hello" language="bash" />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  it('displays copy button', () => {
    renderWithI18n(<CodeBlock code="echo hello" language="bash" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('falls back to plaintext when language is not loaded', async () => {
    mockGetLoadedLanguages.mockReturnValue([]);
    renderWithI18n(<CodeBlock code="hello" language="ruby" />);
    await waitFor(() => {
      expect(mockCodeToHtml).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ lang: 'plaintext' })
      );
    });
  });

  it('uses light theme when not in dark mode', async () => {
    document.documentElement.classList.remove('dark');
    renderWithI18n(<CodeBlock code="const x = 1;" language="typescript" />);
    await waitFor(() => {
      expect(mockCodeToHtml).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ theme: 'one-light' })
      );
    });
  });

  it('uses dark theme when dark class is set on html element', async () => {
    document.documentElement.classList.add('dark');
    renderWithI18n(<CodeBlock code="const x = 1;" language="typescript" />);
    await waitFor(() => {
      expect(mockCodeToHtml).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ theme: 'vitesse-dark' })
      );
    });
    document.documentElement.classList.remove('dark');
  });

  it('shows yarn install command when package manager is yarn', async () => {
    renderWithI18n(
      <CodeBlock
        code="irrelevant"
        language="bash"
        showPackageManagerToggle
        packageName="@jackuait/blok"
      />
    );
    await waitFor(() => {
      expect(mockCodeToHtml).toHaveBeenCalledWith(
        'yarn add @jackuait/blok',
        expect.anything()
      );
    });
  });
});
