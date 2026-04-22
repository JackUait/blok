import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions, SanitizerConfig, HTMLPasteEvent } from '../../../../types';
import type { ToggleItemData, ToggleItemConfig } from '../../../../src/tools/toggle/types';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';
import { simulateInput } from '../../../helpers/simulate';

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

    it('starts open by default in editing mode (data-blok-toggle-open="true")', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const element = toggle.render();

      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
    });

    it('starts open by default in readonly mode (data-blok-toggle-open="true")', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({}, {}, { readOnly: true }));
      const element = toggle.render();

      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
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
    it('has correct config with titleKey and icon', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toolbox = ToggleItem.toolbox;

      expect(toolbox).toBeDefined();

      // Handle both array and single entry format
      const entry = Array.isArray(toolbox) ? toolbox[0] : toolbox;

      expect(entry.titleKey).toBe('toggleList');
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

      // Children should be visible (toggle starts open by default)
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

  describe('empty state', () => {
    it('marks wrapper data-blok-toggle-empty="true" when there are no children', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());
      const wrapper = toggle.render();
      toggle.rendered();

      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('true');
    });

    it('marks wrapper data-blok-toggle-empty="false" when a child has text content', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const childHolder = document.createElement('div');
      childHolder.textContent = 'Child content';
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi
        .fn()
        .mockReturnValue([{ id: 'child-1', holder: childHolder }]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const wrapper = toggle.render();
      toggle.rendered();

      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('false');
    });

    it('stays empty when a child block exists but has no text content', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const childHolder = document.createElement('div');
      childHolder.innerHTML = '<p><br></p>';
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi
        .fn()
        .mockReturnValue([{ id: 'child-1', holder: childHolder }]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const wrapper = toggle.render();
      toggle.rendered();

      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('true');
    });

    it('live-updates empty state as the user types into a child block', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const childHolder = document.createElement('div');
      const childInner = document.createElement('p');
      childInner.innerHTML = '<br>';
      childHolder.appendChild(childInner);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi
        .fn()
        .mockReturnValue([{ id: 'child-1', holder: childHolder }]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const wrapper = toggle.render();
      toggle.rendered();

      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('true');

      // User types into the child block.
      childInner.innerHTML = 'H';
      simulateInput(childInner);

      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('false');

      // User deletes everything.
      childInner.innerHTML = '';
      simulateInput(childInner);

      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('true');
    });
  });

  describe('arrow aria-label updates', () => {
    it('has aria-label Collapse when expanded (default state)', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

      // Toggle starts open by default — aria-label should be Collapse
      expect(arrow.getAttribute('aria-label')).toBe('Collapse');
    });

    it('updates aria-label to Expand when collapsed via click', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

      // Click once to collapse (starts open)
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

    it('shows child block holders when toggle starts open by default on rendered()', async () => {
      const { toggle, childHolders } = await setupToggleWithChildren();
      toggle.render();

      // Simulate the rendered() lifecycle hook
      toggle.rendered();

      // Toggle starts open by default — children should be visible
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(false);
      }
    });

    it('hides child block holders when toggle is collapsed via arrow click', async () => {
      const { toggle, childHolders } = await setupToggleWithChildren();
      const element = toggle.render();
      toggle.rendered();

      // All children should be visible initially (starts open)
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

      // Collapse (starts open)
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

    it('is visible when toggle starts open by default (with no children)', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;

      // Toggle starts open — body placeholder should be visible when no children
      expect(bodyPlaceholder.classList.contains('hidden')).toBe(false);
    });

    it('is visible when toggle is open and has no children (no click needed)', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;

      // Toggle starts open by default — placeholder should already be visible
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

    it('is hidden when toggle is collapsed after starting open', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

      // Collapse (starts open)
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

    it('uses insertInsideParent when body placeholder is clicked', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockNewBlock = { id: 'new-child-block' };
      const mockSetToBlock = vi.fn();
      const mockInsertInsideParent = vi.fn().mockReturnValue(mockNewBlock);
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockIndex = vi.fn().mockReturnValue(2);
      (mockAPI.blocks as unknown as Record<string, unknown>).insertInsideParent = mockInsertInsideParent;
      (mockAPI.blocks as unknown as Record<string, unknown>).insert = vi.fn();
      (mockAPI.blocks as unknown as Record<string, unknown>).setBlockParent = vi.fn();
      (mockAPI as unknown as Record<string, unknown>).caret = { setToBlock: mockSetToBlock };

      const options = createToggleOptions({ isOpen: true });
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;
      bodyPlaceholder.click();

      // insertInsideParent(parentId, insertIndex) — index is getBlockIndex(2) + 1 = 3
      expect(mockInsertInsideParent).toHaveBeenCalledWith('test-block-id', 3);
      expect(mockSetToBlock).toHaveBeenCalledWith('new-child-block', 'start');

      // Must NOT use the old non-atomic pattern
      expect(mockAPI.blocks.insert).not.toHaveBeenCalled();
      expect(mockAPI.blocks.setBlockParent).not.toHaveBeenCalled();
    });

    it('reappears when children are removed and toggle is expanded', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolder = document.createElement('div');
      const mockAPI = createMockAPI();
      const getChildrenMock = vi.fn().mockReturnValue([{ id: 'child-1', holder: childHolder }]);
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = getChildrenMock;

      const options = createToggleOptions({ text: 'toggle', isOpen: true });
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
    // Fix: Vertical alignment — header row uses items-center so arrow SVG center aligns with text center
    it('header row uses items-center class (not items-start) for vertical alignment', async () => {
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

      // The header row is the first child div of the wrapper — it lays out arrow + content
      const headerRow = result.wrapper.querySelector('div');

      expect(headerRow).not.toBeNull();
      expect(headerRow?.classList.contains('items-center')).toBe(true);
      expect(headerRow?.classList.contains('items-start')).toBe(false);
    });

    // Fix 1: Touch target — arrow uses p-[8px] (28px box) with items-center alignment
    it('arrow element has p-[8px] padding class and no mt-px offset', async () => {
      const { buildArrow } = await import('../../../../src/tools/toggle/dom-builder');
      const arrow = buildArrow(true, null);

      expect(arrow.className).toContain('p-[8px]');
      expect(arrow.className).not.toContain('p-[10px]');
      expect(arrow.className).not.toContain('mt-px');
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
    it('child container has aria-hidden removed when toggle is open (default state)', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      // Toggle starts open by default — aria-hidden should not be "true"
      const childContainer = element.querySelector('[data-blok-toggle-children]') as HTMLElement;

      expect(childContainer.getAttribute('aria-hidden')).not.toBe('true');
    });

    it('child container has aria-hidden="true" when toggle is collapsed via click', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;
      // Collapse (starts open)
      arrow.click();

      const childContainer = element.querySelector('[data-blok-toggle-children]') as HTMLElement;

      expect(childContainer.getAttribute('aria-hidden')).toBe('true');
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

      const arrow = element.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`) as HTMLElement;

      // Toggle starts open — focus inside the child
      innerInput.focus();
      expect(innerInput).toHaveFocus();

      // Collapse the toggle (one click, starts open)
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

  describe('normalizeData - legacy toggleList format', () => {
    /**
     * Create options with raw legacy data (no text field added).
     */
    const createLegacyOptions = (
      data: Record<string, unknown>,
      overrides: { readOnly?: boolean } = {}
    ): BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig> => ({
      data: data as unknown as ToggleItemData,
      config: {},
      api: createMockAPI(),
      readOnly: overrides.readOnly ?? false,
      block: { id: 'test-block-id' } as never,
    });

    it('normalizes legacy title field to text', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createLegacyOptions({ title: 'My toggle' }));
      toggle.render();
      const saved = toggle.save();

      expect(saved.text).toBe('My toggle');
    });

    it('normalizes legacy isExpanded field to isOpen', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createLegacyOptions({ title: 'T', isExpanded: true }, { readOnly: true }));
      const element = toggle.render();

      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
    });

    it('normalizes legacy isExpanded=false', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createLegacyOptions({ title: 'T', isExpanded: false }));
      const element = toggle.render();

      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
    });

    it('prefers text field over title when both present', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createLegacyOptions({ text: 'preferred', title: 'legacy' }));
      toggle.render();
      const saved = toggle.save();

      expect(saved.text).toBe('preferred');
    });

    it('handles empty legacy data with title', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createLegacyOptions({ title: '' }));
      toggle.render();
      const saved = toggle.save();

      expect(saved.text).toBe('');
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

  describe('setReadOnly()', () => {
    it('sets contentEditable to false when entering readonly', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({ text: 'Hello' }));
      const element = toggle.render();
      const contentEl = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`) as HTMLElement;

      // Starts editable
      expect(contentEl.contentEditable).toBe('true');

      toggle.setReadOnly(true);

      expect(contentEl.contentEditable).toBe('false');
    });

    it('sets contentEditable to true when exiting readonly', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({ text: 'Hello' }, {}, { readOnly: true }));
      const element = toggle.render();
      const contentEl = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`) as HTMLElement;

      // Starts non-editable
      expect(contentEl.contentEditable).toBe('false');

      toggle.setReadOnly(false);

      expect(contentEl.contentEditable).toBe('true');
    });

    it('preserves DOM content element reference across toggle', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions({ text: 'Hello' }));
      const element = toggle.render();
      const contentBefore = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`);

      toggle.setReadOnly(true);
      toggle.setReadOnly(false);

      // Content element is the same DOM node — setReadOnly mutates in place
      const contentAfter = element.querySelector(`[${TOGGLE_ATTR.toggleContent}]`);

      expect(contentAfter).toBe(contentBefore);
    });

    it('unsubscribes from block changed event when entering readonly', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      toggle.render();

      // Constructor subscribes to 'block changed'
      expect(mockAPI.events.on).toHaveBeenCalledWith('block changed', expect.any(Function));

      const onCallCount = (mockAPI.events.off as ReturnType<typeof vi.fn>).mock.calls.length;

      toggle.setReadOnly(true);

      // Should have called events.off with 'block changed'
      expect(mockAPI.events.off).toHaveBeenCalledWith('block changed', expect.any(Function));
      expect((mockAPI.events.off as ReturnType<typeof vi.fn>).mock.calls.length).toBe(onCallCount + 1);
    });

    it('resubscribes to block changed event when exiting readonly', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions({}, {}, { readOnly: true });
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      toggle.render();

      // Constructor in readOnly mode does NOT subscribe
      expect(mockAPI.events.on).not.toHaveBeenCalled();

      toggle.setReadOnly(false);

      // Should now subscribe to 'block changed'
      expect(mockAPI.events.on).toHaveBeenCalledWith('block changed', expect.any(Function));
    });

    it('does not double-subscribe when called with same state', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      toggle.render();

      // Constructor already subscribed once
      const initialOnCount = (mockAPI.events.on as ReturnType<typeof vi.fn>).mock.calls.length;

      // Call setReadOnly(false) when already NOT readonly — should not re-subscribe
      toggle.setReadOnly(false);

      expect((mockAPI.events.on as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialOnCount);
      expect(mockAPI.events.off).not.toHaveBeenCalled();
    });

    it('is a no-op if element has not been rendered yet', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const toggle = new ToggleItem(createToggleOptions());

      // Should not throw when called before render()
      expect(() => toggle.setReadOnly(true)).not.toThrow();
    });

    it('updates body placeholder visibility based on new readOnly state', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');
      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions({ text: 'toggle', isOpen: true });
      options.api = mockAPI;

      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      const bodyPlaceholder = element.querySelector(`[${TOGGLE_ATTR.toggleBodyPlaceholder}]`) as HTMLElement;

      // Body placeholder is visible when open, no children, and not readonly
      expect(bodyPlaceholder.classList.contains('hidden')).toBe(false);

      // Enter readonly — body placeholder should be hidden
      toggle.setReadOnly(true);

      expect(bodyPlaceholder.classList.contains('hidden')).toBe(true);

      // Exit readonly — body placeholder should reappear
      toggle.setReadOnly(false);

      expect(bodyPlaceholder.classList.contains('hidden')).toBe(false);
    });
  });
});
