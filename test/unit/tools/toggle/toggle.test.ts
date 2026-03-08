import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions, SanitizerConfig, HTMLPasteEvent } from '../../../../types';
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
    t: (key: string) => {
      const translations: Record<string, string> = {
        'tools.toggle.bodyPlaceholder': 'Empty toggle. Click or drop blocks inside.',
        'tools.toggle.ariaLabelCollapse': 'Collapse',
        'tools.toggle.ariaLabelExpand': 'Expand',
      };

      return translations[key] ?? key;
    },
    has: () => false,
  },
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  blocks: {
    splitBlock: vi.fn(),
    convert: vi.fn(),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
    getChildren: vi.fn().mockReturnValue([]),
  },
} as unknown as API);

/**
 * Create constructor options for ToggleItem
 */
const createToggleOptions = (
  data: Partial<ToggleItemData> = {},
  config: ToggleItemConfig = {},
  overrides: { readOnly?: boolean } = {}
): BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig> => ({
  data: { text: '', ...data } as ToggleItemData,
  config,
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
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

    it('starts expanded by default in editing mode (data-blok-toggle-open="true")', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();

      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
    });

    it('starts collapsed by default in readonly mode (data-blok-toggle-open="false")', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({}, {}, { readOnly: true }));
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
      const toolbox = ToggleItem.toolbox;

      expect(toolbox).toBeDefined();

      // Handle both array and single entry format
      const entry = Array.isArray(toolbox) ? toolbox[0] : toolbox;

      expect(entry.title).toBe('Toggle list');
      expect(entry.icon).toBeDefined();
      expect(typeof entry.icon).toBe('string');
    });

    it('has titleKey for i18n', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toolbox = ToggleItem.toolbox;
      const entry = Array.isArray(toolbox) ? toolbox[0] : toolbox;

      expect(entry.titleKey).toBe('toggleList');
    });
  });

  describe('static conversionConfig', () => {
    it('has export: "text" and import: "text"', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const config = ToggleItem.conversionConfig;

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

  describe('static sanitize', () => {
    it('includes mark with class and style attributes', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const sanitize = ToggleItem.sanitize;
      const textRules = sanitize.text as SanitizerConfig;

      expect(textRules.mark).toEqual({ class: true, style: true });
    });

    it('includes code tag', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const sanitize = ToggleItem.sanitize;
      const textRules = sanitize.text as SanitizerConfig;

      expect(textRules.code).toBe(true);
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

    it('reconciles child visibility after data update for undo/redo (Bug 10)', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolders = Array.from({ length: 2 }, (_, i) => {
        const holder = document.createElement('div');
        holder.setAttribute('data-blok-element', '');
        holder.textContent = `Child ${i + 1}`;

        return holder;
      });

      const childBlocks = childHolders.map((holder, i) => ({
        id: `child-${i}`,
        holder,
      }));

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

      const options = createToggleOptions({ text: 'before undo' });
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      toggle.render();
      toggle.rendered();

      // Children should be visible (toggle starts expanded in editing mode)
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(false);
      }

      // Simulate undo/redo calling setData — this should reconcile child visibility
      toggle.setData({ text: 'after undo' });

      // getChildren should have been called during rendered() and setData()
      // Each call to updateChildrenVisibility + updateBodyPlaceholderVisibility = 2 calls per lifecycle
      // rendered() = 2 calls, setData() = 2 calls = 4 total
      expect(mockAPI.blocks.getChildren).toHaveBeenCalledTimes(4);
    });
  });

  describe('arrow aria-label updates', () => {
    it('updates aria-label to Collapse when expanded', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

      // Toggle starts expanded in editing mode — aria-label should already be Collapse
      expect(arrow.getAttribute('aria-label')).toBe('Collapse');
    });

    it('updates aria-label to Expand when collapsed', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

      // Click once to collapse (starts expanded)
      arrow.click();

      expect(arrow.getAttribute('aria-label')).toBe('Expand');
    });
  });

  describe('children visibility', () => {
    /**
     * Creates a ToggleItem with a mock API that returns child block holders.
     * Returns the toggle instance, the mock API, and the child holders.
     */
    const setupToggleWithChildren = async (childCount = 2) => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolders = Array.from({ length: childCount }, (_, i) => {
        const holder = document.createElement('div');
        holder.setAttribute('data-blok-element', '');
        holder.textContent = `Child ${i + 1}`;

        return holder;
      });

      const childBlocks = childHolders.map((holder, i) => ({
        id: `child-${i}`,
        holder,
      }));

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);

      return { toggle, mockAPI, childHolders };
    };

    it('shows child block holders when toggle starts expanded in editing mode on rendered()', async () => {
      const { toggle, childHolders } = await setupToggleWithChildren();
      toggle.render();

      // Simulate the rendered() lifecycle hook
      toggle.rendered();

      // Toggle starts expanded in editing mode — children should be visible
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(false);
      }
    });

    it('hides child block holders when toggle is collapsed via arrow click', async () => {
      const { toggle, childHolders } = await setupToggleWithChildren();
      const element = toggle.render();
      toggle.rendered();

      // All children should be visible initially (editing mode starts expanded)
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(false);
      }

      // Click the arrow to collapse
      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
      arrow.click();

      // Children should now be hidden
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(true);
      }
    });

    it('shows child block holders again when toggle is expanded after collapsing', async () => {
      const { toggle, childHolders } = await setupToggleWithChildren();
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

      // Collapse
      arrow.click();

      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(true);
      }

      // Expand again
      arrow.click();

      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(false);
      }
    });

    it('calls getChildren with the correct block id', async () => {
      const { toggle, mockAPI } = await setupToggleWithChildren();
      toggle.render();
      toggle.rendered();

      expect(mockAPI.blocks.getChildren).toHaveBeenCalledWith('test-block-id');
    });

    it('does nothing when there are no children', async () => {
      const { toggle } = await setupToggleWithChildren(0);
      toggle.render();

      // Should not throw
      toggle.rendered();
    });
  });

  describe('header placeholder', () => {
    it('uses data-blok-placeholder-active attribute', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();
      const contentEl = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`);

      expect(contentEl).not.toBeNull();
      expect(contentEl?.hasAttribute('data-blok-placeholder-active')).toBe(true);
      expect(contentEl?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('has always-visible placeholder classes (not focus-only)', async () => {
      const { PLACEHOLDER_ACTIVE_CLASSES } = await import('../../../../src/components/utils/placeholder');
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();
      const contentEl = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`) as HTMLElement;

      for (const cls of PLACEHOLDER_ACTIVE_CLASSES) {
        expect(contentEl.classList.contains(cls)).toBe(true);
      }
    });

    it('sets placeholder text to "Toggle" by default', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();
      const contentEl = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`);

      expect(contentEl?.getAttribute('data-blok-placeholder-active')).toBe('Toggle');
    });
  });

  describe('body placeholder', () => {
    it('renders a body placeholder element with correct text', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();
      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`);

      expect(bodyPlaceholder).not.toBeNull();
      expect(bodyPlaceholder?.textContent).toBe('Empty toggle. Click or drop blocks inside.');
    });

    it('is visible when toggle is open and has no children', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;

      expect(bodyPlaceholder.classList.contains('hidden')).toBe(false);
    });

    it('is hidden when toggle has children', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolder = document.createElement('div');
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([
        { id: 'child-1', holder: childHolder },
      ]);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;

      expect(bodyPlaceholder.classList.contains('hidden')).toBe(true);
    });

    it('is hidden when toggle is collapsed', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      // Collapse the toggle
      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
      arrow.click();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;

      expect(bodyPlaceholder.classList.contains('hidden')).toBe(true);
    });

    it('is hidden in read-only mode', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions({}, {}, { readOnly: true });
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;

      // In read-only, toggle starts collapsed and body placeholder should be hidden
      expect(bodyPlaceholder.classList.contains('hidden')).toBe(true);
    });

    it('creates child paragraph when clicked', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockNewBlock = { id: 'new-child-block' };
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockIndex = vi.fn().mockReturnValue(0);
      (mockAPI.blocks as unknown as Record<string, unknown>).insert = vi.fn().mockReturnValue(mockNewBlock);
      (mockAPI.blocks as unknown as Record<string, unknown>).setBlockParent = vi.fn();

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;
      bodyPlaceholder.click();

      expect(mockAPI.blocks.insert).toHaveBeenCalledWith(
        'paragraph',
        { text: '' },
        {},
        1,
        true
      );
      expect(mockAPI.blocks.setBlockParent).toHaveBeenCalledWith('new-child-block', 'test-block-id');
    });

    it('reappears when children are removed and toggle is re-expanded', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolder = document.createElement('div');
      const mockAPI = createMockAPI();
      const getChildrenMock = vi.fn().mockReturnValue([{ id: 'child-1', holder: childHolder }]);
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = getChildrenMock;

      const options = createToggleOptions({ text: 'toggle' });
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;

      // With children, placeholder should be hidden
      expect(bodyPlaceholder.classList.contains('hidden')).toBe(true);

      // Simulate children being removed (e.g., undo)
      getChildrenMock.mockReturnValue([]);

      // Trigger re-check via setData (simulating undo/redo)
      toggle.setData({ text: 'toggle' });

      expect(bodyPlaceholder.classList.contains('hidden')).toBe(false);
    });
  });

  describe('accessibility and visual fixes', () => {
    // Fix 1: Touch target minimum 44px
    it('arrow element has p-[10px] padding class for 44px touch target', async () => {
      const { buildArrow } = await import('../../../../src/tools/toggle/dom-builder');
      const arrow = buildArrow(true, null);

      expect(arrow.className).toContain('p-[10px]');
      expect(arrow.className).not.toContain('w-6');
      expect(arrow.className).not.toContain('h-6');
    });

    // Fix 2: aria-controls on arrow pointing to child container
    it('arrow element has aria-controls attribute pointing to child container id', async () => {
      const { buildToggleItem } = await import('../../../../src/tools/toggle/dom-builder');
      const result = buildToggleItem({
        data: { text: '' },
        readOnly: false,
        isOpen: true,
        keydownHandler: null,
        onArrowClick: null,
        onBodyPlaceholderClick: null,
        bodyPlaceholderText: 'Empty toggle. Click or drop blocks inside.',
        ariaLabels: { collapse: 'Collapse', expand: 'Expand' },
      });

      const ariaControls = result.arrowElement.getAttribute('aria-controls');

      expect(ariaControls).toBeTruthy();
      expect(result.childContainerElement.id).toBeTruthy();
      expect(ariaControls).toBe(result.childContainerElement.id);
    });

    // Fix 3: aria-hidden on collapsed container
    it('child container has aria-hidden="true" when toggle is collapsed', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
      // Toggle starts expanded — collapse it
      arrow.click();

      const childContainer = element.querySelector('[data-blok-toggle-children]') as HTMLElement;

      expect(childContainer.getAttribute('aria-hidden')).toBe('true');
    });

    it('child container has aria-hidden removed when toggle is expanded', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
      // Collapse then re-expand
      arrow.click(); // collapse
      arrow.click(); // expand

      const childContainer = element.querySelector('[data-blok-toggle-children]') as HTMLElement;

      expect(childContainer.getAttribute('aria-hidden')).not.toBe('true');
    });

    // Fix 4: Focus moved to arrow when collapsing with focus inside
    it('moves focus to arrow when toggle collapses while focus is inside a child', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolder = document.createElement('div');
      const innerInput = document.createElement('input');
      childHolder.appendChild(innerInput);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([
        { id: 'child-1', holder: childHolder },
      ]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      document.body.appendChild(element);
      toggle.rendered();

      // Focus inside the child
      innerInput.focus();
      expect(innerInput).toHaveFocus();

      // Collapse the toggle
      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
      arrow.click();

      expect(arrow).toHaveFocus();

      document.body.removeChild(element);
    });

  });

  describe('buildToggleItem() - childContainerElement', () => {
    it('returns a childContainerElement property', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();

      // Access the childContainerElement via the data attribute it must carry
      const childContainer = element.querySelector('[data-blok-toggle-children]');

      expect(childContainer).not.toBeNull();
    });

    it('childContainerElement has attribute data-blok-toggle-children', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();

      const childContainer = element.querySelector('[data-blok-toggle-children]');

      expect(childContainer).not.toBeNull();
      expect(childContainer?.hasAttribute('data-blok-toggle-children')).toBe(true);
    });

    it('childContainerElement is a child of the wrapper element', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();

      const childContainer = element.querySelector('[data-blok-toggle-children]');

      expect(childContainer).not.toBeNull();
      expect(element.contains(childContainer)).toBe(true);
    });
  });

  describe('onPaste()', () => {
    it('extracts text from DETAILS summary element', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      toggle.render();

      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.innerHTML = 'Toggle title';
      details.appendChild(summary);
      details.appendChild(document.createTextNode('Child content'));

      const event = { detail: { data: details } } as unknown as HTMLPasteEvent;
      toggle.onPaste(event);

      const saved = toggle.save();

      expect(saved.text).toBe('Toggle title');
    });

    it('uses full innerHTML when no summary element exists', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      toggle.render();

      const details = document.createElement('details');
      details.innerHTML = 'Plain toggle content';

      const event = { detail: { data: details } } as unknown as HTMLPasteEvent;
      toggle.onPaste(event);

      const saved = toggle.save();

      expect(saved.text).toBe('Plain toggle content');
    });
  });
});
