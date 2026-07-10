import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
