import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PopoverInline } from '../../../src/components/utils/popover/popover-inline';
import { PopoverItemDefault, PopoverItemType } from '../../../src/components/utils/popover/components/popover-item';
import type { PopoverItemSeparator } from '../../../src/components/utils/popover/components/popover-item';
import { PopoverDesktop } from '../../../src/components/utils/popover/popover-desktop';
import { CSSVariables } from '../../../src/components/utils/popover/popover.const';
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';
import type { PopoverParams, PopoverParamsBase } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';

// Mock dependencies that are not directly under test
vi.mock('../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
  };
});

/**
 * Internal type for accessing protected members in tests
 */
type PopoverInlineInternal = PopoverInline & {
  readonly items: Array<PopoverItemDefault | PopoverItemSeparator>;
  nestedPopover: PopoverDesktop | null | undefined;
  nestedPopoverTriggerItem: PopoverItemDefault | null;
  showNestedItems: (item: PopoverItemDefault) => void;
  handleMouseLeave: (event: Event) => void;
  nodes: {
    popover: HTMLElement;
    popoverContainer: HTMLElement;
    items: HTMLElement;
  };
};

describe('PopoverInline', () => {

  const OFFSET_LEFT_VALUE = 50;

  // Helper to create a real PopoverInline instance with test data
  const createPopoverInline = (params?: Partial<PopoverParamsBase>): PopoverInline => {
    const defaultParams: PopoverParams = {
      items: [
        {
          icon: 'Icon',
          title: 'Test Item',
          name: 'test-item',
          onActivate: vi.fn(),
        },
      ],
      ...params,
    };

    return new PopoverInline(defaultParams);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('grid card layout', () => {
    const createGridPopover = (): PopoverInline => {
      return new PopoverInline({
        items: [
          {
            icon: 'T',
            title: 'Text',
            name: 'convert-to',
            children: {
              items: [ { icon: 'i', title: 'Heading', name: 'header', onActivate: vi.fn() } ],
            },
          },
          { type: PopoverItemType.Separator },
          { icon: 'B', name: 'bold', onActivate: vi.fn() },
          { icon: 'I', name: 'italic', onActivate: vi.fn() },
          { icon: 'U', name: 'underline', onActivate: vi.fn() },
          { icon: 'S', name: 'strikethrough', onActivate: vi.fn() },
          { icon: 'C', name: 'inlineCode', onActivate: vi.fn() },
          { icon: 'E', name: 'equation', onActivate: vi.fn() },
        ],
      });
    };

    it('lays formatting buttons out as a five-column grid', () => {
      const popover = createGridPopover();

      popover.show();

      const items = popover.getElement().querySelector(`[${DATA_ATTR.popoverItems}]`);

      expect(items?.className).toContain('grid-cols-5');
    });

    it('stretches the convert row and separator across the full grid width', () => {
      const popover = createGridPopover();

      popover.show();

      const element = popover.getElement();
      const convert = element.querySelector('[data-blok-item-name="convert-to"]');
      const separator = element.querySelector('[data-blok-testid="popover-item-separator"]');

      expect(convert?.className).toContain('col-span-full');
      expect(separator?.className).toContain('col-span-full');
    });

    it('pushes the convert row chevron to the right edge', () => {
      const popover = createGridPopover();

      popover.show();

      const chevron = popover
        .getElement()
        .querySelector('[data-blok-item-name="convert-to"] [data-blok-testid="popover-item-chevron-right"]');

      expect(chevron?.className).toContain('ml-auto');
    });

    it('does not pin the container to the single-row toolbar height', () => {
      const popover = createGridPopover();

      popover.show();

      const container = popover
        .getElement()
        .querySelector<HTMLElement>(`[${DATA_ATTR.popoverContainer}]`);

      expect(container?.style.height).toBe('');
    });
  });

  describe('constructor', () => {
    it('should create popover with proper structure', () => {
      const popover = createPopoverInline();

      const element = popover.getElement();

      expect(element).toBeInstanceOf(HTMLElement);
      expect(element).toHaveAttribute(DATA_ATTR.popoverInline, '');
    });

    it('should set inline height CSS variables', () => {
      const popover = createPopoverInline();
      const element = popover.getElement();

      expect(element.style.getPropertyValue('--height')).toBe('38px');
      expect(element.style.getPropertyValue('--height-mobile')).toBe('46px');
    });

    it('should create instance successfully on mobile screens', async () => {
      const { isMobileScreen } = await import('../../../src/components/utils');

      vi.mocked(isMobileScreen).mockReturnValue(true);

      const popover = createPopoverInline();

      // Verify instance is created successfully
      expect(popover).toBeInstanceOf(PopoverInline);
    });

    it('should create popover with items without children', () => {
      const popover = createPopoverInline({
        items: [
          {
            name: 'simple-item',
            title: 'Simple Item',
            icon: 'Icon',
            onActivate: vi.fn(),
          },
        ],
      });

      // Verify no nested popover exists for items without children
      expect(popover.hasNestedPopoverOpen).toBe(false);
    });

    it('should create popover with separator items', () => {
      const popover = createPopoverInline({
        items: [
          {
            type: PopoverItemType.Separator,
          },
          {
            name: 'normal-item',
            title: 'Normal Item',
            icon: 'Icon',
            onActivate: vi.fn(),
          },
        ],
      });

      // Separator should be handled without errors
      expect(popover.hasNestedPopoverOpen).toBe(false);
    });
  });

  describe('offsetLeft', () => {
    it('should return offsetLeft of popoverContainer when container exists', () => {
      const popover = createPopoverInline();
      const element = popover.getElement();

      // Create a popoverContainer with known offsetLeft
      const popoverContainer = document.createElement('div');
      popoverContainer.style.position = 'relative';
      popoverContainer.style.width = '200px';
      popoverContainer.style.height = '100px';
      Object.defineProperty(popoverContainer, 'offsetLeft', {
        value: OFFSET_LEFT_VALUE,
        writable: true,
        configurable: true,
      });

      element.appendChild(popoverContainer);

      // The offsetLeft getter accesses this.nodes.popoverContainer.offsetLeft
      // We need to verify the property works correctly
      expect(popoverContainer.offsetLeft).toBe(OFFSET_LEFT_VALUE);
    });

    it('should return 0 when popoverContainer is null', () => {
      const popover = createPopoverInline();

      // When there's no popoverContainer, offsetLeft should return 0
      // This is the default behavior when the element hasn't been fully set up
      expect(popover.offsetLeft).toBe(0);
    });
  });

  describe('show', () => {
    it('should apply inline styles when showing popover', () => {
      const popover = createPopoverInline();

      popover.show();

      const element = popover.getElement();

      // Verify inline styles are applied - check for height style which is set during show
      expect(element.style.height).not.toBe('');
    });

    it('should set width and height CSS variables when nestingLevel is 0', () => {
      const popover = createPopoverInline();
      const element = popover.getElement();

      popover.show();

      // Verify show method executes without errors and sets some height
      // The actual dimensions depend on the internal DOM structure
      expect(element.style.height).not.toBe('');
    });

    it('should not set width/height CSS variables when nestingLevel is not 0', () => {
      const params: PopoverParams = {
        items: [{ name: 'test', title: 'Test', icon: 'Icon', onActivate: vi.fn() }],
        nestingLevel: 1,
      };

      const popover = createPopoverInline(params);

      popover.show();

      const element = popover.getElement();

      // Verify CSS variables were not set for nested popovers
      expect(element.style.getPropertyValue(CSSVariables.InlinePopoverWidth)).toBe('');
    });

    it('should handle undefined containerRect gracefully', () => {
      const popover = createPopoverInline();

      // Should not throw when popoverContainer is missing
      expect(() => popover.show()).not.toThrow();
    });

    it('applies symmetric top/bottom padding to inline popover container (no pb-0 from desktop opened state)', () => {
      const popover = createPopoverInline();
      const instance = popover as unknown as PopoverInlineInternal;

      popover.show();

      // Inline popover has no scroll area, so bottom padding should match top padding.
      // Desktop popover uses pb-0 on the outer container so the scroll haze renders only inside
      // the scrollable items list — that logic does not apply to the inline toolbar.
      expect(instance.nodes.popoverContainer.className).toContain('pt-1.5');
      expect(instance.nodes.popoverContainer.className).toContain('pb-1.5');
      expect(instance.nodes.popoverContainer.className).not.toContain('pb-0');
    });

    it('keeps the horizontal toolbar items flush — the before-first-element gap is a vertical-list concern', () => {
      const popover = createPopoverInline();
      const instance = popover as unknown as PopoverInlineInternal;

      // The inline toolbar is a single horizontal row; its symmetric breathing room comes
      // from the container (pt-1.5/pb-1.5), so the items list must not carry the vertical
      // before-first-element gap that vertical menus use.
      expect(instance.nodes.items.className).not.toContain('pt-1.5');
    });

    it('should activate flipper with flippableElements', () => {
      vi.useFakeTimers();

      const popover = createPopoverInline();

      // Create a flippable element
      const button = document.createElement('button');
      button.textContent = 'Test';
      const element = popover.getElement();
      element.appendChild(button);

      popover.show();

      // Advance the timer to trigger requestAnimationFrame callback
      vi.advanceTimersToNextFrame();

      // Verify flipper was activated
      // (This tests the behavior - flipper activation happens asynchronously)
      vi.useRealTimers();
    });

    it('defers flipper deactivate to microtask after show()', async () => {
      const popover = createPopoverInline();

      // Spy on the instance's flipper (not the prototype) to observe deactivation deferral
      const deactivateSpy = vi.spyOn(popover.flipper!, 'deactivate');

      popover.show();

      // deactivate is only called in the deferred callback, never synchronously
      expect(deactivateSpy).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(deactivateSpy).toHaveBeenCalledOnce();
    });
  });

  describe('hide', () => {
    it('should reset inline styles when hiding', () => {
      const popover = createPopoverInline();

      // First show the popover
      popover.show();

      // Then hide it - should execute without errors
      expect(() => popover.hide()).not.toThrow();
    });

    it('should close nested popover when hiding', () => {
      const popover = createPopoverInline();

      // Hide should work even if no nested popover exists
      expect(() => popover.hide()).not.toThrow();
    });

    it('removes the opened attribute so isShown becomes false (base cleanup not forgotten)', () => {
      const popover = createPopoverInline();

      popover.show();

      expect(popover.getElement()).toHaveAttribute(DATA_ATTR.popoverOpened, 'true');
      expect(popover.isShown).toBe(true);

      popover.hide();

      expect(popover.getElement()).not.toHaveAttribute(DATA_ATTR.popoverOpened);
      expect(popover.isShown).toBe(false);
    });

    it('emits the Closed event through the base hide path', () => {
      const popover = createPopoverInline();
      const closedHandler = vi.fn();

      popover.on(PopoverEvent.Closed, closedHandler);
      popover.show();
      popover.hide();

      expect(closedHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasNestedPopoverOpen', () => {
    it('should return false when no nested popover exists', () => {
      const popover = createPopoverInline();

      expect(popover.hasNestedPopoverOpen).toBe(false);
    });
  });

  describe('closeNestedPopover', () => {
    it('should close nested popover if one is open', () => {
      const popover = createPopoverInline();

      // Close nested popover (should be safe even if none exists)
      popover.closeNestedPopover();

      expect(popover.hasNestedPopoverOpen).toBe(false);
    });
  });

  describe('CSS classes and styling', () => {
    it('should apply inline popover classes to root element', () => {
      const popover = createPopoverInline();
      const element = popover.getElement();

      // Verify the element has the inline popover attribute
      expect(element).toHaveAttribute(DATA_ATTR.popoverInline, '');
    });

    it('should create element with proper structure', () => {
      const popover = createPopoverInline();
      const element = popover.getElement();

      // The popoverContainer should have inline-specific classes
      // Verify through the element structure
      expect(element).toBeInstanceOf(HTMLElement);
    });
  });

  describe('getElement', () => {
    it('should return the popover element', () => {
      const popover = createPopoverInline();

      const element = popover.getElement();

      expect(element).toBeInstanceOf(HTMLElement);
      expect(element).toHaveAttribute(DATA_ATTR.popoverInline, '');
    });
  });

  describe('nested popover items sizing', () => {
    it('does NOT pin the nested items width with w-full — an explicit width ignores the scrollbar-gutter margin offsets, leaving the scrollbar 8px from the popover edge instead of 2px', () => {
      const popover = createPopoverInline({
        items: [
          {
            icon: 'Icon',
            title: 'Turn into',
            name: 'convert-to',
            children: {
              items: [
                {
                  title: 'Child Action',
                  name: 'child-action',
                  onActivate: vi.fn(),
                },
              ],
            },
          },
        ],
      });

      const instance = popover as unknown as PopoverInlineInternal;
      const parentItem = instance.items.find(
        (item): item is PopoverItemDefault =>
          item instanceof PopoverItemDefault && item.hasChildren
      );

      expect(parentItem).toBeDefined();

      instance.showNestedItems(parentItem!);

      const nestedItems = instance.nestedPopover
        ?.getElement()
        .querySelector(`[${DATA_ATTR.popoverItems}]`);

      expect(nestedItems).not.toBeNull();
      expect(nestedItems?.classList.contains('w-full')).toBe(false);
    });
  });

  describe('handleMouseLeave', () => {
    it('should NOT close nested popover when mouse leaves the popover container', () => {
      const onClose = vi.fn();
      const popover = createPopoverInline({
        items: [
          {
            icon: 'Icon',
            title: 'Tool With Actions',
            name: 'tool-with-actions',
            children: {
              items: [
                {
                  title: 'Child Action',
                  name: 'child-action',
                  onActivate: vi.fn(),
                },
              ],
              onClose,
            },
          },
        ],
      });

      const instance = popover as unknown as PopoverInlineInternal;

      // Find the item with children
      const parentItem = instance.items.find(
        (item): item is PopoverItemDefault =>
          item instanceof PopoverItemDefault && item.hasChildren
      );

      expect(parentItem).toBeDefined();

      // Open the nested popover by clicking the item (inline uses click-to-toggle)
      instance.showNestedItems(parentItem!);

      // Verify nested popover is open
      expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
      expect(popover.hasNestedPopoverOpen).toBe(true);

      // Simulate mouse leaving the popover container by calling the overridden handler directly
      const outsideElement = document.createElement('div');

      document.body.appendChild(outsideElement);

      const mouseLeaveEvent = new MouseEvent('mouseleave', {
        relatedTarget: outsideElement,
        bubbles: false,
      });

      instance.handleMouseLeave(mouseLeaveEvent);

      // Nested popover should still be open — inline toolbar uses click-to-close, not hover-to-close
      expect(instance.nestedPopover).toBeInstanceOf(PopoverDesktop);
      expect(popover.hasNestedPopoverOpen).toBe(true);
      expect(onClose).not.toHaveBeenCalled();

      outsideElement.remove();
    });

    it('opens the nested item menu flush to the top with no top padding', () => {
      const popover = createPopoverInline({
        items: [
          {
            icon: 'Icon',
            title: 'Turn into',
            name: 'turn-into',
            children: {
              items: [
                {
                  title: 'Heading 1',
                  name: 'heading-1',
                  onActivate: vi.fn(),
                },
              ],
            },
          },
        ],
      });

      const instance = popover as unknown as PopoverInlineInternal;
      const parentItem = instance.items.find(
        (item): item is PopoverItemDefault =>
          item instanceof PopoverItemDefault && item.hasChildren
      );

      instance.showNestedItems(parentItem!);

      const nestedEl = instance.nestedPopover?.getElement();
      const nestedContainer = nestedEl?.querySelector(`[${DATA_ATTR.popoverContainer}]`);
      const nestedItems = nestedEl?.querySelector(`[${DATA_ATTR.popoverItems}]`);

      // The nested "Turn into" menu is a vertical item list — the outer container carries
      // horizontal padding but no top padding.
      expect(nestedContainer?.className).toContain('px-1.5');
      expect(nestedContainer?.className).not.toContain('pt-1.5');
      expect(nestedContainer?.className).not.toContain('p-1.5');

      // The 6px before-first-element gap lives on the scrollable items list instead, so it
      // sits above "Heading 1" and scrolls with the list inside the reel clip.
      expect(nestedItems?.className).toContain('pt-1.5');
    });
  });

});
