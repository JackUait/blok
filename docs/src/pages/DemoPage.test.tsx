import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

    it('re-aligns the editor content when alignment is changed in the panel', async () => {
      const { container } = renderDemoPage();

      fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Center' }));

      await waitFor(() => {
        expect(container.querySelector('.blok-editor')).toHaveAttribute('data-blok-content-align', 'center');
      });
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
