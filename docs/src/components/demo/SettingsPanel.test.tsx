import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { I18nProvider } from '../../contexts/I18nContext';
import { SettingsPanel } from './SettingsPanel';
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from './editor-settings';

function renderPanel(overrides: Partial<EditorSettings> = {}) {
  const onSettingsChange = vi.fn();
  const settings: EditorSettings = { ...DEFAULT_EDITOR_SETTINGS, ...overrides };

  render(
    <I18nProvider>
      <SettingsPanel settings={settings} onSettingsChange={onSettingsChange} />
    </I18nProvider>
  );

  return { onSettingsChange, settings };
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Open editor settings' }));
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('edge tab', () => {
    it('renders a tab button on the right edge to open the panel', () => {
      renderPanel();

      expect(screen.getByRole('button', { name: 'Open editor settings' })).toBeInTheDocument();
    });

    it('does not show the panel content until opened', () => {
      renderPanel();

      expect(screen.queryByRole('heading', { name: 'Editor settings' })).not.toBeInTheDocument();
    });
  });

  describe('opening and closing', () => {
    it('opens the panel when the tab is clicked', () => {
      renderPanel();

      openPanel();

      expect(screen.getByRole('heading', { name: 'Editor settings' })).toBeInTheDocument();
    });

    it('hides the edge tab while the panel is open', () => {
      renderPanel();

      openPanel();

      expect(screen.queryByRole('button', { name: 'Open editor settings' })).not.toBeInTheDocument();
    });

    it('shows no explanatory hint texts in the header or footer', () => {
      renderPanel();

      openPanel();

      expect(screen.queryByText(/Changes apply to the editor live/)).not.toBeInTheDocument();
      expect(screen.queryByText(/reload/)).not.toBeInTheDocument();
    });

    it('shows no subtitles under the switches', () => {
      renderPanel();

      openPanel();

      expect(screen.queryByText(/Locks the content/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Places the caret/)).not.toBeInTheDocument();
      expect(screen.queryByText(/drag handle/)).not.toBeInTheDocument();
    });

    it('closes via the close button', () => {
      renderPanel();

      openPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Close editor settings' }));

      expect(screen.queryByRole('heading', { name: 'Editor settings' })).not.toBeInTheDocument();
    });

    it('closes on Escape', () => {
      renderPanel();

      openPanel();
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('heading', { name: 'Editor settings' })).not.toBeInTheDocument();
    });
  });

  describe('open/close animation', () => {
    it('keeps the closed panel mounted off-screen so it can slide in', () => {
      renderPanel();

      const panel = screen.getByTestId('demo-settings-panel');
      expect(panel.className).toContain('transition-transform');
      // The floating panel sits a gap away from the edge, so sliding it fully
      // out needs its own width plus that gap.
      expect(panel.className).toMatch(/translate-x-\[calc\(100%\+/);
      expect(panel).toHaveAttribute('inert');
    });

    it('slides the panel in when opened', () => {
      renderPanel();

      openPanel();

      const panel = screen.getByTestId('demo-settings-panel');
      expect(panel.className).toContain('translate-x-0');
      expect(panel.className).not.toMatch(/translate-x-\[calc\(100%\+/);
      expect(panel).not.toHaveAttribute('inert');
    });

    it('renders as a floating rounded card instead of a flush drawer', () => {
      renderPanel();

      const panel = screen.getByTestId('demo-settings-panel');
      expect(panel.className).toContain('rounded-3xl');
      expect(panel.className).toContain('inset-y-3');
      expect(panel.className).toContain('right-3');
      expect(panel.className).not.toContain('inset-y-0');
      expect(panel.className).not.toContain('right-0');
    });

    it('slides the edge tab out while the panel is open', () => {
      renderPanel();

      openPanel();

      const tab = screen.getByTestId('demo-settings-tab');
      expect(tab.className).toContain('transition-');
      expect(tab.className).toContain('translate-x-full');
      expect(tab).toHaveAttribute('inert');
    });

    it('slides the edge tab back in after closing', () => {
      renderPanel();

      openPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Close editor settings' }));

      const tab = screen.getByTestId('demo-settings-tab');
      expect(tab.className).not.toContain('translate-x-full');
      expect(tab).not.toHaveAttribute('inert');
    });
  });

  describe('toggles', () => {
    it('turns read-only mode on', () => {
      const { onSettingsChange } = renderPanel();

      openPanel();
      fireEvent.click(screen.getByRole('switch', { name: 'Read-only mode' }));

      expect(onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_EDITOR_SETTINGS, readOnly: true });
    });

    it('reflects the current read-only state via aria-checked', () => {
      renderPanel({ readOnly: true });

      openPanel();

      expect(screen.getByRole('switch', { name: 'Read-only mode' })).toHaveAttribute('aria-checked', 'true');
    });

    it('turns autofocus on', () => {
      const { onSettingsChange } = renderPanel();

      openPanel();
      fireEvent.click(screen.getByRole('switch', { name: 'Autofocus on load' }));

      expect(onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_EDITOR_SETTINGS, autofocus: true });
    });

    it('turns hide-toolbar on', () => {
      const { onSettingsChange } = renderPanel();

      openPanel();
      fireEvent.click(screen.getByRole('switch', { name: 'Hide toolbar' }));

      expect(onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_EDITOR_SETTINGS, hideToolbar: true });
    });
  });

  describe('segmented choices', () => {
    it('forces the dark theme', () => {
      const { onSettingsChange } = renderPanel();

      openPanel();
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));

      expect(onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_EDITOR_SETTINGS, theme: 'dark' });
    });

    it('marks the active theme option as checked', () => {
      renderPanel({ theme: 'dark' });

      openPanel();

      expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Match site' })).toHaveAttribute('aria-checked', 'false');
    });

    it('switches to full width', () => {
      const { onSettingsChange } = renderPanel();

      openPanel();
      fireEvent.click(screen.getByRole('radio', { name: 'Full' }));

      expect(onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_EDITOR_SETTINGS, width: 'full' });
    });

    it('changes content alignment', () => {
      const { onSettingsChange } = renderPanel();

      openPanel();
      fireEvent.click(screen.getByRole('radio', { name: 'Center' }));

      expect(onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_EDITOR_SETTINGS, contentAlign: 'center' });
    });
  });

  describe('segmented control animation', () => {
    it('renders a sliding pill that sits under the active option', () => {
      renderPanel({ theme: 'dark' });

      openPanel();

      const group = screen.getByRole('radiogroup', { name: 'Theme' });
      const thumb = within(group).getByTestId('segmented-thumb');
      expect(thumb.className).toContain('transition-transform');
      // 'dark' is the third of three options — the pill slides two widths over.
      expect(thumb.style.transform).toBe('translateX(200%)');
      // jsdom normalizes the calc — just check it's a third of the padded track.
      expect(thumb.style.width).toContain('100% - 0.5rem');
      expect(thumb.style.width).toMatch(/0\.333|\/ 3/);
    });

    it('moves the pill when another option is chosen', () => {
      renderPanel({ contentAlign: 'center' });

      openPanel();

      const group = screen.getByRole('radiogroup', { name: 'Content alignment' });
      const thumb = within(group).getByTestId('segmented-thumb');
      expect(thumb.style.transform).toBe('translateX(100%)');
    });

    it('paints the active label via text color instead of a per-button background', () => {
      renderPanel();

      openPanel();

      const active = screen.getByRole('radio', { name: 'Narrow' });
      expect(active.className).not.toContain('bg-foreground');
      expect(active.className).toContain('text-background');
    });
  });

  describe('placeholder', () => {
    it('updates the placeholder text', () => {
      const { onSettingsChange } = renderPanel();

      openPanel();
      fireEvent.change(screen.getByRole('textbox', { name: 'First block placeholder' }), {
        target: { value: 'Start writing…' },
      });

      expect(onSettingsChange).toHaveBeenCalledWith({
        ...DEFAULT_EDITOR_SETTINGS,
        placeholder: 'Start writing…',
      });
    });
  });

  describe('reset', () => {
    it('restores the defaults', () => {
      const { onSettingsChange } = renderPanel({ readOnly: true, theme: 'dark', width: 'full' });

      openPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

      expect(onSettingsChange).toHaveBeenCalledWith(DEFAULT_EDITOR_SETTINGS);
    });
  });
});
