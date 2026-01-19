import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rerenderListItem,
  saveListItem,
  setListItemData,
  mergeListItemData,
  renderListSettings,
  type RerenderContext,
} from '../../../../src/tools/list/block-operations';
import type { ListItemData, ListItemStyle, StyleConfig } from '../../../../src/tools/list/types';
import { parseHTML } from '../../../../src/tools/list/content-operations';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover/popover-item';

/**
 * Type guard to check if a menu config item is a default params item
 */
const isDefaultParamsItem = (item: unknown): item is PopoverItemDefaultBaseParams => {
  return (
    typeof item === 'object' &&
    item !== null &&
    'onActivate' in item
  );
};

describe('block-operations', () => {
  describe('rerenderListItem', () => {
    const createMockElement = (style: ListItemStyle = 'unordered', depth = 0): HTMLElement => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-blok-tool', 'list');
      wrapper.setAttribute('data-list-style', style);
      wrapper.setAttribute('data-list-depth', String(depth));

      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');

      const marker = document.createElement('span');
      marker.setAttribute('data-list-marker', 'true');
      marker.textContent = style === 'ordered' ? '1.' : '•';

      const content = document.createElement('div');
      content.contentEditable = 'true';
      content.textContent = 'Old content';

      listItem.appendChild(marker);
      listItem.appendChild(content);
      wrapper.appendChild(listItem);

      return wrapper;
    };

    const createMockContext = (overrides: Partial<ListItemData> = {}): {
      data: ListItemData;
      readOnly: boolean;
      placeholder: string;
      itemColor: string | undefined;
      itemSize: string | undefined;
      element: HTMLElement | null;
      setupItemPlaceholder: ReturnType<typeof vi.fn>;
      onCheckboxChange: ReturnType<typeof vi.fn>;
      keydownHandler: ReturnType<typeof vi.fn>;
    } => {
      const data: ListItemData = {
        text: 'New content',
        style: 'unordered',
        checked: false,
        depth: 0,
        ...overrides,
      };

      const setupItemPlaceholder = vi.fn();
      const onCheckboxChange = vi.fn();
      const keydownHandler = vi.fn();

      return {
        data,
        readOnly: false,
        placeholder: 'List item',
        itemColor: undefined,
        itemSize: undefined,
        element: createMockElement(),
        setupItemPlaceholder,
        onCheckboxChange,
        keydownHandler,
      };
    };

    it('replaces the old element with new wrapper', () => {
      const context = createMockContext();
      const parent = document.createElement('div');
      if (context.element) {
        parent.appendChild(context.element);
      }

      const oldWrapper = context.element;
      const result = rerenderListItem(context as RerenderContext);

      expect(result).not.toBe(oldWrapper);
      expect(parent.contains(result)).toBe(true);
      expect(parent.contains(oldWrapper)).toBe(false);
    });

    it('returns null when element is null', () => {
      const context = createMockContext();
      context.element = null;

      const result = rerenderListItem(context as RerenderContext);

      expect(result).toBeNull();
    });

    it('returns null when element has no parent', () => {
      const context = createMockContext();
      // Element exists but no parent (detached from DOM)
      // Can't set parentNode to null as it's read-only, so we just test behavior with detached element
      const detachedElement = context.element;
      if (!detachedElement) {
        throw new Error('Expected element to exist');
      }
      // Detach the element if it has a parent
      if (detachedElement.parentNode) {
        detachedElement.parentNode.removeChild(detachedElement);
      }

      const result = rerenderListItem({ ...context, element: detachedElement } as RerenderContext);

      expect(result).toBeNull();
    });

    it('calls setupItemPlaceholder on new content element', () => {
      const context = createMockContext();
      const parent = document.createElement('div');
      if (context.element) {
        parent.appendChild(context.element);
      }

      rerenderListItem(context as RerenderContext);

      expect(context.setupItemPlaceholder).toHaveBeenCalled();
      // The content element is passed - check it has the data-blok-testid
      const calls = context.setupItemPlaceholder.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const calledWithElement = calls[0][0] as HTMLElement;
      expect(calledWithElement.querySelector('[data-blok-testid="list-content-container"]')).not.toBeNull();
    });

    it('attaches checkbox change handler for checklist items', () => {
      const onCheckboxChange = vi.fn();
      const context = createMockContext({ style: 'checklist' });
      context.onCheckboxChange = onCheckboxChange;
      const parent = document.createElement('div');
      if (context.element) {
        parent.appendChild(context.element);
      }

      const result = rerenderListItem(context as RerenderContext);

      if (!result) {
        throw new Error('Expected result to be an HTMLElement');
      }

      const checkbox = result.querySelector('input[type="checkbox"]');
      if (!checkbox || !(checkbox instanceof HTMLInputElement)) {
        throw new Error('Expected checkbox to exist');
      }

      // Simulate user clicking the checkbox which triggers both click and change events
      checkbox.click();

      expect(onCheckboxChange).toHaveBeenCalledWith(true, expect.any(HTMLElement));
      // Verify the observable state - checkbox is now checked
      expect(checkbox.checked).toBe(true);
    });

    it('attaches keydown handler to new wrapper', () => {
      const keydownHandler = vi.fn();
      const context = createMockContext();
      context.keydownHandler = keydownHandler;
      const parent = document.createElement('div');
      if (context.element) {
        parent.appendChild(context.element);
      }

      const result = rerenderListItem(context as RerenderContext);

      if (!result) {
        throw new Error('Expected result to be an HTMLElement');
      }

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      result.dispatchEvent(event);

      expect(keydownHandler).toHaveBeenCalledWith(event);
    });

    it('preserves data attributes on new wrapper', () => {
      const context = createMockContext({ style: 'ordered', depth: 2 });
      const parent = document.createElement('div');
      if (context.element) {
        parent.appendChild(context.element);
      }

      const result = rerenderListItem(context as RerenderContext);

      if (!result) {
        throw new Error('Expected result to be an HTMLElement');
      }

      expect(result).toHaveAttribute('data-list-style', 'ordered');
      expect(result).toHaveAttribute('data-list-depth', '2');
    });
  });

  describe('saveListItem', () => {
    const createMockElement = (innerHTML = 'Content', style = 'unordered', depth = 0): HTMLElement => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-blok-tool', 'list');
      wrapper.setAttribute('data-list-style', style);

      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      if (depth > 0) {
        listItem.style.marginLeft = `${depth * 24}px`;
      }

      const marker = document.createElement('span');
      marker.setAttribute('data-list-marker', 'true');
      marker.textContent = '•';

      const content = document.createElement('div');
      // Use data-blok-testid attribute as used in production code
      content.setAttribute('data-blok-testid', style === 'checklist' ? 'list-checklist-content' : 'list-content-container');
      content.contentEditable = 'true';
      content.innerHTML = innerHTML;

      listItem.appendChild(marker);
      listItem.appendChild(content);
      wrapper.appendChild(listItem);

      return wrapper;
    };

    it('returns data with text from content element', () => {
      const element = createMockElement('Saved content');
      const data: ListItemData = { text: '', style: 'unordered', checked: false };

      const result = saveListItem(data, element, () => element.querySelector('[data-blok-testid="list-content-container"]') as HTMLElement);

      expect(result.text).toBe('Saved content');
      expect(result.style).toBe('unordered');
    });

    it('returns original data when element is null', () => {
      const data: ListItemData = { text: 'Original', style: 'ordered', checked: false };

      const result = saveListItem(data, null, () => null);

      expect(result.text).toBe('Original');
    });

    it('preserves checked state', () => {
      const element = createMockElement('Content', 'checklist');
      const data: ListItemData = { text: '', style: 'checklist', checked: true };

      const result = saveListItem(data, element, () => element.querySelector('[data-blok-testid="list-checklist-content"]') as HTMLElement);

      expect(result.checked).toBe(true);
    });

    it('preserves start value when not default', () => {
      const element = createMockElement('Content', 'ordered');
      const data: ListItemData = { text: '', style: 'ordered', checked: false, start: 5 };

      const result = saveListItem(data, element, () => element.querySelector('[data-blok-testid="list-content-container"]') as HTMLElement);

      expect(result.start).toBe(5);
    });

    it('omits start value when default is 1', () => {
      const element = createMockElement('Content', 'ordered');
      const data: ListItemData = { text: '', style: 'ordered', checked: false, start: 1 };

      const result = saveListItem(data, element, () => element.querySelector('[data-blok-testid="list-content-container"]') as HTMLElement);

      expect(result.start).toBeUndefined();
    });

    it('preserves depth when greater than 0', () => {
      const element = createMockElement('Content', 'unordered', 2);
      const data: ListItemData = { text: '', style: 'unordered', checked: false, depth: 2 };

      const result = saveListItem(data, element, () => element.querySelector('[data-blok-testid="list-content-container"]') as HTMLElement);

      expect(result.depth).toBe(2);
    });

    it('omits depth when 0', () => {
      const element = createMockElement('Content', 'unordered', 0);
      const data: ListItemData = { text: '', style: 'unordered', checked: false, depth: 0 };

      const result = saveListItem(data, element, () => element.querySelector('[data-blok-testid="list-content-container"]') as HTMLElement);

      expect(result.depth).toBeUndefined();
    });

    it('handles when getContentElement returns null', () => {
      const element = createMockElement('Content');
      const data: ListItemData = { text: 'Original', style: 'unordered', checked: false };

      const result = saveListItem(data, element, () => null);

      expect(result.text).toBe('Original');
    });
  });

  describe('setListItemData', () => {
    let mockElement: HTMLElement;
    let mockContentElement: HTMLElement;

    beforeEach(() => {
      mockElement = document.createElement('div');
      mockElement.setAttribute('data-list-depth', '0');

      mockContentElement = document.createElement('div');
      mockContentElement.contentEditable = 'true';
      mockContentElement.textContent = 'Original content';
      mockElement.appendChild(mockContentElement);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      mockElement.appendChild(checkbox);
    });

    it('returns inPlace: false when element is null', () => {
      const currentData: ListItemData = { text: '', style: 'unordered', checked: false };
      const newData: ListItemData = { text: 'New', style: 'unordered', checked: false };

      const result = setListItemData(
        currentData,
        newData,
        null,
        () => mockContentElement,
        {
          adjustDepthTo: vi.fn(),
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState: vi.fn(),
        }
      );

      expect(result.inPlace).toBe(false);
    });

    it('returns inPlace: false when style changes', () => {
      const currentData: ListItemData = { text: 'Content', style: 'unordered', checked: false };
      const newData: ListItemData = { text: 'Content', style: 'ordered', checked: false };

      const result = setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo: vi.fn(),
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState: vi.fn(),
        }
      );

      expect(result.inPlace).toBe(false);
    });

    it('returns inPlace: true when only text changes', () => {
      const currentData: ListItemData = { text: 'Old', style: 'unordered', checked: false };
      const newData: ListItemData = { text: 'New', style: 'unordered', checked: false };

      const adjustDepthTo = vi.fn();
      const updateMarkerForDepth = vi.fn();
      const updateCheckboxState = vi.fn();

      const result = setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        { adjustDepthTo, updateMarkerForDepth, updateCheckboxState }
      );

      expect(result.inPlace).toBe(true);
      expect(mockContentElement.innerHTML).toBe('New');
      expect(adjustDepthTo).not.toHaveBeenCalled();
      expect(updateMarkerForDepth).not.toHaveBeenCalled();
      expect(updateCheckboxState).not.toHaveBeenCalled();
    });

    it('updates depth when depth changes', () => {
      const currentData: ListItemData = { text: 'Content', style: 'unordered', checked: false, depth: 0 };
      const newData: ListItemData = { text: 'Content', style: 'unordered', checked: false, depth: 2 };

      const adjustDepthTo = vi.fn();
      const updateMarkerForDepth = vi.fn();

      const result = setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo,
          updateMarkerForDepth,
          updateCheckboxState: vi.fn(),
        }
      );

      expect(result.inPlace).toBe(true);
      expect(result.newData.depth).toBe(2);
      expect(adjustDepthTo).toHaveBeenCalledWith(2);
      expect(updateMarkerForDepth).toHaveBeenCalledWith(2, 'unordered');
    });

    it('does not call update operations when depth unchanged', () => {
      const currentData: ListItemData = { text: 'Content', style: 'unordered', checked: false, depth: 2 };
      const newData: ListItemData = { text: 'Content', style: 'unordered', checked: false, depth: 2 };

      const adjustDepthTo = vi.fn();
      const updateMarkerForDepth = vi.fn();

      setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo,
          updateMarkerForDepth,
          updateCheckboxState: vi.fn(),
        }
      );

      expect(adjustDepthTo).not.toHaveBeenCalled();
      expect(updateMarkerForDepth).not.toHaveBeenCalled();
    });

    it('updates checkbox state for checklist items', () => {
      const currentData: ListItemData = { text: 'Content', style: 'checklist', checked: false };
      const newData: ListItemData = { text: 'Content', style: 'checklist', checked: true };

      const updateCheckboxState = vi.fn();

      const result = setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo: vi.fn(),
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState,
        }
      );

      expect(result.inPlace).toBe(true);
      expect(updateCheckboxState).toHaveBeenCalledWith(true);
    });

    it('does not update checkbox for non-checklist items', () => {
      const currentData: ListItemData = { text: 'Content', style: 'unordered', checked: false };
      const newData: ListItemData = { text: 'Content', style: 'unordered', checked: true };

      const updateCheckboxState = vi.fn();

      setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo: vi.fn(),
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState,
        }
      );

      expect(updateCheckboxState).not.toHaveBeenCalled();
    });

    it('handles depth: 0 in newData (explicit zero)', () => {
      const currentData: ListItemData = { text: 'Content', style: 'unordered', checked: false, depth: 2 };
      const newData: ListItemData = { text: 'Content', style: 'unordered', checked: false, depth: 0 };

      const adjustDepthTo = vi.fn();

      const result = setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo,
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState: vi.fn(),
        }
      );

      expect(result.inPlace).toBe(true);
      expect(result.newData.depth).toBe(0);
      expect(adjustDepthTo).toHaveBeenCalledWith(0);
    });

    it('handles when depth is missing in newData (treats as 0)', () => {
      const currentData: ListItemData = { text: 'Content', style: 'unordered', checked: false, depth: 2 };
      const newData: ListItemData = { text: 'Content', style: 'unordered', checked: false };

      const adjustDepthTo = vi.fn();

      const result = setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo,
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState: vi.fn(),
        }
      );

      expect(result.inPlace).toBe(true);
      expect(result.newData.depth).toBe(0);
      expect(adjustDepthTo).toHaveBeenCalledWith(0);
    });

    it('merges all properties from newData', () => {
      const currentData: ListItemData = { text: 'Old', style: 'unordered', checked: false };
      const newData: ListItemData = { text: 'New', style: 'unordered', checked: true, depth: 1, start: 5 };

      const result = setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo: vi.fn(),
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState: vi.fn(),
        }
      );

      expect(result.newData).toEqual({ text: 'New', style: 'unordered', checked: true, depth: 1, start: 5 });
    });

    it('updates text content when text is a string', () => {
      const currentData: ListItemData = { text: 'Old', style: 'unordered', checked: false };
      const newData: ListItemData = { text: 'New text', style: 'unordered', checked: false };

      setListItemData(
        currentData,
        newData,
        mockElement,
        () => mockContentElement,
        {
          adjustDepthTo: vi.fn(),
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState: vi.fn(),
        }
      );

      expect(mockContentElement.innerHTML).toBe('New text');
    });

    it('handles when contentElement is null', () => {
      const currentData: ListItemData = { text: 'Old', style: 'unordered', checked: false };
      const newData: ListItemData = { text: 'New', style: 'unordered', checked: false };

      const result = setListItemData(
        currentData,
        newData,
        mockElement,
        () => null,
        {
          adjustDepthTo: vi.fn(),
          updateMarkerForDepth: vi.fn(),
          updateCheckboxState: vi.fn(),
        }
      );

      expect(result.inPlace).toBe(true);
    });
  });

  describe('mergeListItemData', () => {
    let mockElement: HTMLElement;
    let mockContentElement: HTMLElement;

    beforeEach(() => {
      mockElement = document.createElement('div');
      mockContentElement = document.createElement('div');
      mockContentElement.contentEditable = 'true';
      mockContentElement.textContent = 'Original';
      mockElement.appendChild(mockContentElement);
    });

    it('merges text from source data', () => {
      const contextData: ListItemData = { text: 'Original', style: 'unordered', checked: false };
      const sourceData: ListItemData = { text: ' Added', style: 'ordered', checked: false };

      mergeListItemData(
        { data: contextData, element: mockElement, getContentElement: () => mockContentElement, parseHTML },
        sourceData
      );

      expect(contextData.text).toBe('Original Added');
    });

    it('appends parsed HTML to content element', () => {
      const contextData: ListItemData = { text: 'Original', style: 'unordered', checked: false };
      const sourceData: ListItemData = { text: '<strong> Bold</strong>', style: 'ordered', checked: false };

      mergeListItemData(
        { data: contextData, element: mockElement, getContentElement: () => mockContentElement, parseHTML },
        sourceData
      );

      expect(mockContentElement.innerHTML).toContain('Original');
      expect(mockContentElement.innerHTML).toContain('<strong');
    });

    it('normalizes content element after merge', () => {
      const contextData: ListItemData = { text: 'Original', style: 'unordered', checked: false };
      const sourceData: ListItemData = { text: ' Added', style: 'ordered', checked: false };

      // Create a scenario where normalization would have an effect:
      // Set up content with adjacent text nodes that should be merged
      mockContentElement.innerHTML = 'Original';
      // Add a separate text node (simulating what might happen during HTML parsing)
      const textNode = document.createTextNode(' extra');
      mockContentElement.appendChild(textNode);

      mergeListItemData(
        { data: contextData, element: mockElement, getContentElement: () => mockContentElement, parseHTML },
        sourceData
      );

      // Verify the observable behavior - text content is properly merged
      expect(mockContentElement).toHaveTextContent('Original Added');
    });

    it('does nothing when element is null', () => {
      const contextData: ListItemData = { text: 'Original', style: 'unordered', checked: false };
      const sourceData: ListItemData = { text: ' Added', style: 'ordered', checked: false };
      const initialText = contextData.text;

      mergeListItemData(
        { data: contextData, element: null, getContentElement: () => mockContentElement, parseHTML },
        sourceData
      );

      expect(contextData.text).toBe(initialText);
    });

    it('does nothing when contentElement is null', () => {
      const contextData: ListItemData = { text: 'Original', style: 'unordered', checked: false };
      const sourceData: ListItemData = { text: ' Added', style: 'ordered', checked: false };

      mergeListItemData(
        { data: contextData, element: mockElement, getContentElement: () => null, parseHTML },
        sourceData
      );

      // Data text is still merged
      expect(contextData.text).toBe('Original Added');
    });

    it('handles empty source text', () => {
      const contextData: ListItemData = { text: 'Original', style: 'unordered', checked: false };
      const sourceData: ListItemData = { text: '', style: 'ordered', checked: false };

      mergeListItemData(
        { data: contextData, element: mockElement, getContentElement: () => mockContentElement, parseHTML },
        sourceData
      );

      expect(contextData.text).toBe('Original');
    });

    it('handles source with HTML tags', () => {
      const contextData: ListItemData = { text: '', style: 'unordered', checked: false };
      const sourceData: ListItemData = { text: '<b>Bold</b> and <i>italic</i>', style: 'ordered', checked: false };

      mergeListItemData(
        { data: contextData, element: mockElement, getContentElement: () => mockContentElement, parseHTML },
        sourceData
      );

      expect(mockContentElement.innerHTML).toContain('<b>');
      expect(mockContentElement.innerHTML).toContain('<i>');
    });
  });

  describe('renderListSettings', () => {
    const createMockStyleConfig = (style: ListItemStyle, titleKey: string): StyleConfig => ({
      style,
      name: style,
      icon: `<svg>${style}</svg>`,
      titleKey,
    });

    it('returns array of menu config items', () => {
      const availableStyles = [
        createMockStyleConfig('unordered', 'bulletedList'),
        createMockStyleConfig('ordered', 'numberedList'),
        createMockStyleConfig('checklist', 'todoList'),
      ];

      const setStyle = vi.fn();
      const t = vi.fn((key: string) => `Translated: ${key}`);

      const result = renderListSettings(availableStyles, 'unordered', t, setStyle);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
    });

    it('marks current style as active', () => {
      const availableStyles = [
        createMockStyleConfig('unordered', 'bulletedList'),
        createMockStyleConfig('ordered', 'numberedList'),
      ];

      const setStyle = vi.fn();
      const t = vi.fn((key: string) => key);

      const result = renderListSettings(availableStyles, 'unordered', t, setStyle);

      const items = Array.isArray(result) ? result : [result];
      expect(isDefaultParamsItem(items[0])).toBe(true);
      expect(isDefaultParamsItem(items[1])).toBe(true);
      if (isDefaultParamsItem(items[0]) && isDefaultParamsItem(items[1])) {
        expect(items[0].isActive).toBe(true);
        expect(items[1].isActive).toBe(false);
      }
    });

    it('uses translation function for labels', () => {
      const availableStyles = [
        createMockStyleConfig('unordered', 'bulletedList'),
      ];

      const setStyle = vi.fn();
      const t = vi.fn((key: string) => `Translated: ${key}`);

      const result = renderListSettings(availableStyles, 'unordered', t, setStyle);

      const items = Array.isArray(result) ? result : [result];
      if (isDefaultParamsItem(items[0])) {
        expect(items[0].title).toBe('Translated: toolNames.bulletedList');
      }
    });

    it('includes icon from style config', () => {
      const availableStyles = [
        createMockStyleConfig('unordered', 'bulletedList'),
      ];

      const setStyle = vi.fn();
      const t = vi.fn((key: string) => key);

      const result = renderListSettings(availableStyles, 'unordered', t, setStyle);

      const items = Array.isArray(result) ? result : [result];
      if (isDefaultParamsItem(items[0])) {
        expect(items[0].icon).toBe('<svg>unordered</svg>');
      }
    });

    it('sets closeOnActivate to true', () => {
      const availableStyles = [
        createMockStyleConfig('unordered', 'bulletedList'),
      ];

      const setStyle = vi.fn();
      const t = vi.fn((key: string) => key);

      const result = renderListSettings(availableStyles, 'unordered', t, setStyle);

      const items = Array.isArray(result) ? result : [result];
      if (isDefaultParamsItem(items[0])) {
        expect(items[0].closeOnActivate).toBe(true);
      }
    });

    it('creates onActivate handler that calls setStyle', () => {
      const availableStyles = [
        createMockStyleConfig('unordered', 'bulletedList'),
        createMockStyleConfig('ordered', 'numberedList'),
      ];

      const setStyle = vi.fn();
      const t = vi.fn((key: string) => key);

      const result = renderListSettings(availableStyles, 'unordered', t, setStyle);

      const items = Array.isArray(result) ? result : [result];
      if (isDefaultParamsItem(items[1])) {
        items[1].onActivate?.(items[1], undefined);
        expect(setStyle).toHaveBeenCalledWith('ordered');
      }
    });

    it('filters styles based on availableStyles config', () => {
      const availableStyles = [
        createMockStyleConfig('unordered', 'bulletedList'),
        createMockStyleConfig('checklist', 'todoList'),
      ];

      const setStyle = vi.fn();
      const t = vi.fn((key: string) => key);

      const result = renderListSettings(availableStyles, 'unordered', t, setStyle);

      const items = Array.isArray(result) ? result : [result];
      expect(items).toHaveLength(2);
      if (isDefaultParamsItem(items[0]) && isDefaultParamsItem(items[1])) {
        expect(items[0].icon).toContain('unordered');
        expect(items[1].icon).toContain('checklist');
      }
    });
  });
});
