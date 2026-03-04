import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('page structure', () => {
    it('renders navigation', () => {
      renderDemoPage();

      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('renders a main element', () => {
      renderDemoPage();

      expect(screen.getByRole('main')).toBeInTheDocument();
    });

    it('renders footer', () => {
      renderDemoPage();

      expect(screen.getByTestId('footer-brand')).toBeInTheDocument();
    });

    it('renders the "Interactive Demo" badge', () => {
      renderDemoPage();

      expect(screen.getByText('Interactive Demo')).toBeInTheDocument();
    });

    it('renders the demo page heading', () => {
      renderDemoPage();

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('renders the editor component', () => {
      const { container } = renderDemoPage();

      // EditorWrapper renders a .blok-editor container
      expect(container.querySelector('.blok-editor')).toBeInTheDocument();
    });
  });

  describe('toolbar actions', () => {
    it('renders the Get JSON button', () => {
      renderDemoPage();

      expect(screen.getByTitle('Get JSON output')).toBeInTheDocument();
    });

    it('renders the Undo button', () => {
      renderDemoPage();

      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    });

    it('renders the Redo button', () => {
      renderDemoPage();

      expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument();
    });

    it('renders the Clear (delete) button', () => {
      renderDemoPage();

      expect(screen.getByTitle('Clear editor')).toBeInTheDocument();
    });
  });

  describe('output panel', () => {
    it('does not show the output panel on initial render', () => {
      renderDemoPage();

      // OutputPanel is only shown when showOutput is true
      expect(screen.queryByTestId('output-panel')).not.toBeInTheDocument();
    });

    it('shows the output panel after clicking Get JSON', async () => {
      const user = userEvent.setup();

      renderDemoPage();

      // Wait for editor to initialize via the mock
      await waitFor(() => {
        expect(screen.queryByText('Loading editor...')).not.toBeInTheDocument();
      });

      const getJsonBtn = screen.getByTitle('Get JSON output');
      await user.click(getJsonBtn);

      await waitFor(() => {
        expect(screen.getByTestId('output-panel')).toBeInTheDocument();
      });
    });

    it('displays JSON output after clicking Get JSON', async () => {
      const user = userEvent.setup();

      renderDemoPage();

      await waitFor(() => {
        expect(screen.queryByText('Loading editor...')).not.toBeInTheDocument();
      });

      const getJsonBtn = screen.getByTitle('Get JSON output');
      await user.click(getJsonBtn);

      await waitFor(() => {
        // The mock save() returns { blocks: [] }, serialized as JSON
        const outputContent = screen.getByTestId('output-content');
        expect(outputContent).toHaveTextContent('blocks');
      });
    });

    it('closes the output panel when the close button is clicked', async () => {
      const user = userEvent.setup();

      renderDemoPage();

      await waitFor(() => {
        expect(screen.queryByText('Loading editor...')).not.toBeInTheDocument();
      });

      // Open the panel
      await user.click(screen.getByTitle('Get JSON output'));

      await waitFor(() => {
        expect(screen.getByTestId('output-panel')).toBeInTheDocument();
      });

      // Close it
      await user.click(screen.getByRole('button', { name: 'Close output panel' }));

      await waitFor(() => {
        expect(screen.queryByTestId('output-panel')).not.toBeInTheDocument();
      });
    });
  });

  describe('keyboard shortcut tips', () => {
    it('shows the slash command tip', () => {
      renderDemoPage();

      expect(screen.getByText('Open command menu')).toBeInTheDocument();
    });

    it('shows the Tab key tip', () => {
      renderDemoPage();

      expect(screen.getByText('Indent list item')).toBeInTheDocument();
    });

    it('shows the Ctrl+Z undo tip', () => {
      renderDemoPage();

      expect(screen.getByText('Undo')).toBeInTheDocument();
    });
  });

  describe('feature hint cards', () => {
    it('shows the Instant Feedback hint', () => {
      renderDemoPage();

      expect(screen.getByText('Instant Feedback')).toBeInTheDocument();
    });

    it('shows the Clean JSON Output hint', () => {
      renderDemoPage();

      expect(screen.getByText('Clean JSON Output')).toBeInTheDocument();
    });

    it('shows the Block-Based Architecture hint', () => {
      renderDemoPage();

      expect(screen.getByText('Block-Based Architecture')).toBeInTheDocument();
    });
  });
});
