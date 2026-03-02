import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants';
import {
  TOGGLE_ATTR,
  TOOL_NAME,
} from '../../../../src/tools/toggle/constants';
import { buildToggleItem } from '../../../../src/tools/toggle/dom-builder';
import type { ToggleDOMBuilderContext } from '../../../../src/tools/toggle/dom-builder';
import type { ToggleItemData } from '../../../../src/tools/toggle/types';

const createDefaultContext = (overrides: Partial<ToggleDOMBuilderContext> = {}): ToggleDOMBuilderContext => ({
  data: { text: 'Hello toggle' } as ToggleItemData,
  readOnly: false,
  isOpen: false,
  keydownHandler: null,
  onArrowClick: vi.fn(),
  ...overrides,
});

describe('Toggle DOM Builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildToggleItem', () => {
    it('returns wrapper, arrowElement, and contentElement', () => {
      const context = createDefaultContext();
      const result = buildToggleItem(context);

      expect(result.wrapper).toBeInstanceOf(HTMLElement);
      expect(result.arrowElement).toBeInstanceOf(HTMLElement);
      expect(result.contentElement).toBeInstanceOf(HTMLElement);
    });

    it('sets data-blok-tool attribute to toggle on wrapper', () => {
      const context = createDefaultContext();
      const result = buildToggleItem(context);

      expect(result.wrapper.getAttribute(DATA_ATTR.tool)).toBe(TOOL_NAME);
    });

    it('applies BASE_STYLES and TOGGLE_WRAPPER_STYLES to wrapper', () => {
      const context = createDefaultContext();
      const result = buildToggleItem(context);

      // twMerge may reorder classes, so check for key classes
      const wrapperClasses = result.wrapper.className;
      expect(wrapperClasses).toContain('outline-hidden');
      expect(wrapperClasses).toContain('flex');
      expect(wrapperClasses).toContain('items-start');
    });

    describe('toggle open state', () => {
      it('sets data-blok-toggle-open="false" when closed', () => {
        const context = createDefaultContext({ isOpen: false });
        const result = buildToggleItem(context);

        expect(result.wrapper.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
      });

      it('sets data-blok-toggle-open="true" when open', () => {
        const context = createDefaultContext({ isOpen: true });
        const result = buildToggleItem(context);

        expect(result.wrapper.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
      });
    });

    describe('arrow element', () => {
      it('has data-blok-toggle-arrow attribute', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.arrowElement.hasAttribute(TOGGLE_ATTR.toggleArrow)).toBe(true);
      });

      it('has role="button" and tabindex="-1"', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.arrowElement.getAttribute('role')).toBe('button');
        expect(result.arrowElement.getAttribute('tabindex')).toBe('-1');
      });

      it('has aria-label attribute', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.arrowElement.getAttribute('aria-label')).toBeTruthy();
      });

      it('contains the arrow SVG icon', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.arrowElement.querySelector('svg')).not.toBeNull();
      });

      it('has no rotation transform when closed', () => {
        const context = createDefaultContext({ isOpen: false });
        const result = buildToggleItem(context);

        expect(result.arrowElement.style.transform).toBe('');
      });

      it('has rotate(90deg) transform when open', () => {
        const context = createDefaultContext({ isOpen: true });
        const result = buildToggleItem(context);

        expect(result.arrowElement.style.transform).toBe('rotate(90deg)');
      });

      it('has transition classes via Tailwind', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.arrowElement.className).toContain('transition-all');
        expect(result.arrowElement.className).toContain('duration-200');
      });

      it('calls onArrowClick when clicked', () => {
        const onArrowClick = vi.fn();
        const context = createDefaultContext({ onArrowClick });
        const result = buildToggleItem(context);

        result.arrowElement.click();

        expect(onArrowClick).toHaveBeenCalledOnce();
      });

      it('stops event propagation on click', () => {
        const onArrowClick = vi.fn();
        const context = createDefaultContext({ onArrowClick });
        const result = buildToggleItem(context);

        const event = new MouseEvent('click', { bubbles: true });
        const stopPropagation = vi.spyOn(event, 'stopPropagation');

        result.arrowElement.dispatchEvent(event);

        expect(stopPropagation).toHaveBeenCalledOnce();
      });
    });

    describe('content element', () => {
      it('has data-blok-toggle-content attribute', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.contentElement.hasAttribute(TOGGLE_ATTR.toggleContent)).toBe(true);
      });

      it('renders text from data', () => {
        const context = createDefaultContext({ data: { text: 'My toggle text' } });
        const result = buildToggleItem(context);

        expect(result.contentElement.innerHTML).toBe('My toggle text');
      });

      it('renders HTML content from data', () => {
        const context = createDefaultContext({ data: { text: '<b>Bold</b> text' } });
        const result = buildToggleItem(context);

        expect(result.contentElement.innerHTML).toBe('<b>Bold</b> text');
      });

      it('has contentEditable="true" when not readOnly', () => {
        const context = createDefaultContext({ readOnly: false });
        const result = buildToggleItem(context);

        expect(result.contentElement.contentEditable).toBe('true');
      });

      it('has contentEditable="false" when readOnly', () => {
        const context = createDefaultContext({ readOnly: true });
        const result = buildToggleItem(context);

        expect(result.contentElement.contentEditable).toBe('false');
      });

      it('attaches keydown handler when provided', () => {
        const keydownHandler = vi.fn();
        const context = createDefaultContext({ keydownHandler });
        const result = buildToggleItem(context);

        const event = new KeyboardEvent('keydown', { key: 'Enter' });
        result.contentElement.dispatchEvent(event);

        expect(keydownHandler).toHaveBeenCalledOnce();
      });

      it('does not attach keydown handler when null', () => {
        const context = createDefaultContext({ keydownHandler: null });
        const result = buildToggleItem(context);

        // Should not throw
        const event = new KeyboardEvent('keydown', { key: 'Enter' });
        result.contentElement.dispatchEvent(event);
      });
    });

    describe('DOM structure', () => {
      it('wrapper contains arrow element as first child', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.wrapper.firstElementChild).toBe(result.arrowElement);
      });

      it('wrapper contains content element as second child', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.wrapper.children[1]).toBe(result.contentElement);
      });

      it('wrapper has exactly two children', () => {
        const context = createDefaultContext();
        const result = buildToggleItem(context);

        expect(result.wrapper.children.length).toBe(2);
      });
    });
  });
});
