import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../contexts/I18nContext';
import { DemoPage } from './DemoPage';

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
  });

  afterEach(() => {
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

    it('does not add an outer max-width that would squeeze the block toolbar gutter', () => {
      renderDemoPage();

      // Each block self-centers its own 720px content column (mx-auto +
      // max-w-blok-content, set by the editor itself) and its +/drag-handle
      // toolbar bleeds ~60px to the left of that column. An outer max-width
      // here narrower than content+gutter (e.g. max-w-3xl/768px) leaves no
      // room for that bleed and the overflow-auto container clips it.
      const editorContainer = screen.getByTestId('demo-editor-container');
      expect(editorContainer.className).not.toMatch(/\bmax-w-\S+/);
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

  describe('locale switching', () => {
    it('renders without crashing when locale is set to RU', () => {
      localStorage.setItem('blok-docs-locale', 'ru');
      renderDemoPage();

      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });
});
