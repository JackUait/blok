import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions, ConversionConfig, ToolboxConfig } from '../../../../types';
import type { ToggleItemData, ToggleItemConfig } from '../../../../src/tools/toggle/types';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';

/**
 * Create a mock API for testing
 */
const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: {
    t: (key: string) => key,
    has: () => false,
  },
  blocks: {
    splitBlock: vi.fn(),
    convert: vi.fn(),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
  },
} as unknown as API);

/**
 * Create constructor options for ToggleItem
 */
const createToggleOptions = (
  data: Partial<ToggleItemData> = {},
  config: ToggleItemConfig = {}
): BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig> => ({
  data: { text: '', ...data } as ToggleItemData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'test-block-id' } as never,
});

describe('ToggleItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('render()', () => {
    it('returns an HTMLElement', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();

      expect(element).toBeInstanceOf(HTMLElement);
    });

    it('sets data-blok-tool="toggle"', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();

      expect(element).toHaveAttribute('data-blok-tool', 'toggle');
    });

    it('renders text content in the toggle-content element', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({ text: 'Hello world' }));
      const element = toggle.render();
      const contentEl = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`);

      expect(contentEl).not.toBeNull();
      expect(contentEl?.innerHTML).toBe('Hello world');
    });

    it('starts collapsed by default (data-blok-toggle-open="false")', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();

      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
    });
  });

  describe('save()', () => {
    it('returns text from the content element', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({ text: 'Saved text' }));
      toggle.render();
      const savedData = toggle.save();

      expect(savedData.text).toBe('Saved text');
    });
  });

  describe('validate()', () => {
    it('always returns true (toggles can be empty, they may have children)', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());

      expect(toggle.validate({ text: '' })).toBe(true);
      expect(toggle.validate({ text: 'some text' })).toBe(true);
    });
  });

  describe('static toolbox', () => {
    it('has correct config with title and icon', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toolbox = ToggleItem.toolbox as ToolboxConfig;

      expect(toolbox).toBeDefined();

      // Handle both array and single entry format
      const entry = Array.isArray(toolbox) ? toolbox[0] : toolbox;

      expect(entry.title).toBe('Toggle');
      expect(entry.icon).toBeDefined();
      expect(typeof entry.icon).toBe('string');
    });
  });

  describe('static conversionConfig', () => {
    it('has export: "text" and import: "text"', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const config = ToggleItem.conversionConfig as ConversionConfig;

      expect(config.export).toBe('text');
      expect(config.import).toBe('text');
    });
  });

  describe('static isReadOnlySupported', () => {
    it('is true', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      expect(ToggleItem.isReadOnlySupported).toBe(true);
    });
  });

  describe('renderSettings()', () => {
    it('returns an empty array', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const settings = toggle.renderSettings();

      expect(settings).toEqual([]);
    });
  });

  describe('merge()', () => {
    it('appends incoming text to existing text', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({ text: 'Hello ' }));
      toggle.render();

      toggle.merge({ text: 'world' });

      const saved = toggle.save();

      expect(saved.text).toBe('Hello world');
    });
  });

  describe('setData()', () => {
    it('updates content element text', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({ text: 'original' }));
      const element = toggle.render();

      toggle.setData({ text: 'updated' });

      const contentEl = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`);

      expect(contentEl?.innerHTML).toBe('updated');
    });
  });
});
