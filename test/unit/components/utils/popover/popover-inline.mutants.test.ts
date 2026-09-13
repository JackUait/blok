import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { Flipper } from '../../../../../src/components/flipper';
import type { PopoverItemDefault} from '../../../../../src/components/utils/popover/components/popover-item';
import { PopoverItemType } from '../../../../../src/components/utils/popover/components/popover-item';
import { PopoverInline } from '../../../../../src/components/utils/popover/popover-inline';
import { css, cssInline, CSSVariables } from '../../../../../src/components/utils/popover/popover.const';
import * as tooltip from '../../../../../src/components/utils/tooltip';
import { twMerge } from '../../../../../src/components/utils/tw';

import type { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverParams } from '@/types/utils/popover/popover';

vi.mock('../../../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
  };
});

type Internal = PopoverInline & {
  readonly items: PopoverItemDefault[];
  nestedPopover: PopoverDesktop | null | undefined;
  nestedPopoverTriggerItem: PopoverItemDefault | null;
  showNestedItems: (item: PopoverItemDefault) => void;
  flipper?: Flipper;
  nodes: {
    popover: HTMLElement;
    popoverContainer: HTMLElement | null;
    items: HTMLElement | null;
  };
};

const activated = new Set<Flipper>();
const originalActivate = Flipper.prototype.activate;

Flipper.prototype.activate = function activate(this: Flipper, ...args: Parameters<typeof originalActivate>): void {
  activated.add(this);
  originalActivate.apply(this, args);
};

const mountedPopovers: PopoverInline[] = [];

/**
 * Builds a popover and mounts it, since the tooltip refuses to anchor to a
 * disconnected element and `show()` measures the container.
 * @param params - popover params overriding the single default item
 */
const make = (params?: Partial<PopoverParams>): PopoverInline => {
  const popover = new PopoverInline({
    items: [ { icon: 'I', title: 'Test', name: 'test-item', onActivate: vi.fn() } ],
    ...params,
  } as PopoverParams);

  document.body.appendChild(popover.getElement());
  mountedPopovers.push(popover);

  return popover;
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  activated.forEach(flipper => flipper.deactivate());
  activated.clear();
  mountedPopovers.splice(0);
  tooltip.destroy();
  vi.restoreAllMocks();
});

describe('PopoverInline — mutation residue', () => {
  describe('onHide inline reset', () => {
    it('resets the root and container classes and clears the measured height', () => {
      const popover = make();
      const instance = popover as unknown as Internal;

      popover.show();
      instance.nodes.popoverContainer.style.height = '50px';
      popover.hide();

      expect(instance.nodes.popoverContainer.style.height).toBe('');
      expect(instance.nodes.popoverContainer.className).toBe(twMerge(css.popoverContainer, cssInline.popoverContainer));
      expect(instance.nodes.popover.className).toBe(twMerge(cssInline.popover));
    });

  });

  describe('opened state', () => {
    it('makes the root an inline-block box when shown', () => {
      const popover = make();
      const instance = popover as unknown as Internal;

      popover.show();

      expect(instance.nodes.popover.className).toBe(twMerge(cssInline.popover, 'inline-block'));
    });

    it('publishes the measured container box as width variable, width and height', () => {
      const popover = make();
      const instance = popover as unknown as Internal;

      instance.nodes.popoverContainer.getBoundingClientRect = (): DOMRect => ({
        width: 120,
        height: 38,
      } as DOMRect);

      popover.show();

      expect(instance.nodes.popover.style.getPropertyValue(CSSVariables.InlinePopoverWidth)).toBe('120px');
      expect(instance.nodes.popover.style.width).toBe('120px');
      expect(instance.nodes.popover.style.height).toBe('38px');
    });

  });

  describe('offsetLeft', () => {
    it('reports the container offset', () => {
      const popover = make();
      const instance = popover as unknown as Internal;

      Object.defineProperty(instance.nodes.popoverContainer, 'offsetLeft', {
        value: 50,
        configurable: true,
      });

      expect(popover.offsetLeft).toBe(50);
    });

    it('reports 0 when there is no container', () => {
      const popover = make();
      const instance = popover as unknown as Internal;

      // The real class types popoverContainer as non-null; the Internal
      // intersection cannot widen it, so the write needs its own view.
      const nodes = instance.nodes as unknown as { popoverContainer: HTMLElement | null };

      nodes.popoverContainer = null;

      expect(popover.offsetLeft).toBe(0);
    });
  });

  describe('construction-time inline styling', () => {
    it('stamps the inline container and items classes before any show()', () => {
      const popover = make();
      const instance = popover as unknown as Internal;

      expect(instance.nodes.popoverContainer.className).toBe(twMerge(css.popoverContainer, cssInline.popoverContainer));
      expect(instance.nodes.items.className).toBe(twMerge(css.items, cssInline.items));
      expect(instance.nodes.popover.getAttribute(DATA_ATTR.popoverInline)).toBe('');
      expect(instance.nodes.popover.style.getPropertyValue('--height')).toBe('38px');
      expect(instance.nodes.popover.style.getPropertyValue('--height-mobile')).toBe('46px');
    });

    it('keeps inline icons gapless — no trailing icon margin', () => {
      const popover = make();
      const icon = popover.getElement().querySelector('[data-blok-testid="popover-item-icon"]');

      expect(icon?.className).not.toContain('mr-2.5');
      expect(icon?.className).not.toContain('mr-0!');
    });

    it('renders default items as buttons so Safari keeps the selection', () => {
      const popover = make();
      const item = popover.getElement().querySelector(`[${DATA_ATTR.itemName}="test-item"]`);

      expect(item?.tagName).toBe('BUTTON');
    });

    it('lays out an html item as an inline flex row', () => {
      const element = document.createElement('div');
      const popover = make({
        items: [ { type: PopoverItemType.Html, element } ],
      });
      const root = popover.getElement().querySelector('[data-blok-popover-item-html]') ?? element.parentElement;

      expect(root?.className).toContain('flex items-center');
    });

    it('turns separators vertical for the horizontal toolbar', () => {
      const popover = make({
        items: [
          { icon: 'B', name: 'bold', onActivate: vi.fn() },
          { type: PopoverItemType.Separator },
          { icon: 'I', name: 'italic', onActivate: vi.fn() },
        ],
      });
      const separator = popover.getElement().querySelector('[data-blok-testid="popover-item-separator"]');
      const line = separator?.firstElementChild;

      expect(separator?.className).toBe(twMerge('py-1.5 max-h-5 overflow-hidden', 'px-1 py-0 h-6 max-h-none shrink-0 mobile:hidden'));
      expect(line?.className).toContain('w-px');
      expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    });
  });

  describe('children normalization', () => {
    it('does not invent children for items that declare none', () => {
      const popover = make({
        items: [ { icon: 'B', title: 'Bold', name: 'bold', onActivate: vi.fn() } ],
      });
      const instance = popover as unknown as Internal;
      const item = popover.getElement().querySelector(`[${DATA_ATTR.itemName}="bold"]`);

      expect(instance.items[0].hasChildren).toBe(false);
      expect(item?.querySelector('[data-blok-testid="popover-item-chevron-right"]')).toBeNull();
    });
  });

  describe('convert row styling', () => {
    const makeConvert = (): PopoverInline => make({
      items: [
        {
          icon: 'T',
          title: 'Text',
          name: 'convert-to',
          children: { items: [ { icon: 'i', title: 'Heading', name: 'header', onActivate: vi.fn() } ] },
        },
      ],
    });

    it('renders the convert label at medium weight', () => {
      const popover = makeConvert();
      const title = popover.getElement().querySelector('[data-blok-testid="popover-item-title"]');

      expect(title?.classList.contains('font-medium')).toBe(true);
    });
  });

  describe('auto-opened submenu', () => {
    const makeOpen = (): PopoverInline => make({
      items: [
        {
          icon: 'L',
          title: 'Link',
          name: 'link',
          children: {
            isOpen: true,
            items: [ { title: 'Child', name: 'child', onActivate: vi.fn() } ],
          },
        },
      ],
    });

    it('opens the submenu of an already-open item while constructing', () => {
      const popover = makeOpen();
      const instance = popover as unknown as Internal;

      expect(instance.nestedPopover).toBeTruthy();
      expect(popover.hasNestedPopoverOpen).toBe(true);
      expect(instance.nestedPopoverTriggerItem).toBe(instance.items[0]);
    });

    it('leaves a closed-children item alone', () => {
      const popover = make({
        items: [
          {
            icon: 'L',
            title: 'Link',
            name: 'link',
            children: { items: [ { title: 'Child', name: 'child', onActivate: vi.fn() } ] },
          },
        ],
      });

      expect(popover.hasNestedPopoverOpen).toBe(false);
    });
  });

  describe('hints', () => {
    const makeHinted = (): PopoverInline => make({
      items: [ {
        icon: 'B',
        name: 'bold',
        hint: { title: 'Bold', description: 'CMD+B' },
        onActivate: vi.fn(),
      } ],
    });

    const hover = (popover: PopoverInline): void => {
      popover.show();
      const item = popover.getElement().querySelector<HTMLElement>(`[${DATA_ATTR.itemName}="bold"]`)!;

      // jsdom has no layout; give the trigger a real box mid-viewport so the
      // tooltip's collision flip has room on every side and keeps the asked-for side.
      item.getBoundingClientRect = (): DOMRect => ({
        top: 300,
        bottom: 340,
        left: 300,
        right: 340,
        width: 40,
        height: 40,
      } as DOMRect);

      item.dispatchEvent(new MouseEvent('mouseenter'));
    };

    it('points the hint bubble above the toolbar row, never sideways', () => {
      const popover = makeHinted();

      hover(popover);

      expect(document.querySelector('[data-blok-testid="tooltip"]')?.getAttribute('data-blok-placement')).toBe('top');
    });

    it('describes the hovered tool on a pointer device', () => {
      const popover = makeHinted();

      hover(popover);

      const item = popover.getElement().querySelector(`[${DATA_ATTR.itemName}="bold"]`);

      expect(item?.getAttribute('aria-describedby')).toBe('blok-tooltip');
      expect(document.querySelector('[data-blok-testid="tooltip"]')).toHaveAttribute('data-state', 'open');
    });
  });

  describe('keyboard navigation', () => {
    const makeTwo = (): PopoverInline => make({
      items: [
        { icon: 'B', name: 'bold', onActivate: vi.fn() },
        { icon: 'I', name: 'italic', onActivate: vi.fn() },
      ],
    });

    it('moves the cursor down the toolbar with ArrowDown', async () => {
      const popover = makeTwo();

      popover.show();
      await Promise.resolve();

      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
      }));

      expect(popover.getElement().querySelector(`[${DATA_ATTR.itemName}="bold"]`)?.className).toContain('is-focused');
    });

  });

  describe('nested popover', () => {
    const openNested = (): { popover: PopoverInline; instance: Internal; nested: HTMLElement } => {
      const popover = make({
        items: [ {
          icon: 'T',
          title: 'Turn into',
          name: 'convert-to',
          children: { items: [ { title: 'Heading', name: 'header', onActivate: vi.fn() } ] },
        } ],
      });
      const instance = popover as unknown as Internal;

      Object.defineProperty(instance.nodes.popoverContainer, 'offsetLeft', {
        value: 50,
        configurable: true,
      });
      Object.defineProperty(instance.items[0].getElement()!, 'offsetLeft', {
        value: 7,
        configurable: true,
      });

      instance.showNestedItems(instance.items[0]);

      return { popover,
        instance,
        nested: instance.nestedPopover!.getElement() };
    };

    it('anchors the submenu to the trigger item, offset by the toolbar origin', () => {
      const { nested } = openNested();

      expect(nested.style.getPropertyValue(CSSVariables.TriggerItemLeft)).toBe('57px');
    });

    it('marks the submenu with its nesting level', () => {
      const { nested } = openNested();

      expect(nested.getAttribute(DATA_ATTR.nestedLevel)).toBe('level-1');
    });

    it('drops the submenu top padding and stacks its rows', () => {
      const { nested } = openNested();
      const container = nested.querySelector(`[${DATA_ATTR.popoverContainer}]`);

      expect(container?.className).toContain('h-fit');
      expect(container?.className).toContain('pb-0');
      expect(container?.className).toContain('flex-col');
      expect(container?.className).toContain('px-1.5');
    });

    it('lays the submenu item list out as a block', () => {
      const { nested } = openNested();
      const items = nested.querySelector(`[${DATA_ATTR.popoverItems}]`);

      expect(items?.className).toContain('block');
    });

    it('lets the submenu keep navigating while the caret is in editable text', () => {
      const { instance } = openNested();

      expect(instance.nestedPopover?.flipper?.getHandleContentEditableTargets()).toBe(true);
    });
  });

  describe('html items', () => {
    const makeHtml = (children?: unknown): { popover: PopoverInline; root: HTMLElement } => {
      const element = document.createElement('span');

      element.textContent = 'field';

      const popover = make({
        items: [ {
          type: PopoverItemType.Html,
          element,
          name: 'link-field',
          hint: { title: 'Link', description: 'CMD+K' },
          ...(children !== undefined ? { children } : {}),
        } ],
      } as unknown as Partial<PopoverParams>);

      return { popover,
        root: element.parentElement as HTMLElement };
    };

    it('points an html item hint above the toolbar row too', () => {
      const { popover, root } = makeHtml();

      popover.show();
      root.getBoundingClientRect = (): DOMRect => ({
        top: 300,
        bottom: 340,
        left: 300,
        right: 340,
        width: 40,
        height: 40,
      } as DOMRect);

      root.dispatchEvent(new MouseEvent('mouseenter'));

      expect(document.querySelector('[data-blok-testid="tooltip"]')?.getAttribute('data-blok-placement')).toBe('top');
      expect(root.getAttribute('aria-describedby')).toBe('blok-tooltip');
    });

    it('opens the submenu of an already-open html item while constructing', () => {
      const { popover } = makeHtml({
        isOpen: true,
        items: [ { title: 'Child', name: 'child', onActivate: vi.fn() } ],
      });

      expect(popover.hasNestedPopoverOpen).toBe(true);
    });
  });

  describe('editable targets', () => {
    it('keeps handling keys typed while the caret is in editable text', () => {
      const popover = make();
      const instance = popover as unknown as Internal;

      expect(instance.flipper?.getHandleContentEditableTargets()).toBe(true);
    });
  });

  describe('non-interactive items', () => {
    it('never opens a submenu for a separator carrying stray children', () => {
      // Untyped (JS) callers can hand a separator a `children` blob; a separator
      // has no trigger element, so it must be skipped, not opened.
      const popover = make({
        items: [
          { icon: 'B', name: 'bold', onActivate: vi.fn() },
          {
            type: PopoverItemType.Separator,
            children: {
              isOpen: true,
              items: [ { title: 'Child', name: 'child', onActivate: vi.fn() } ],
            },
          },
        ],
      } as unknown as Partial<PopoverParams>);

      expect(popover.hasNestedPopoverOpen).toBe(false);
    });
  });

  describe('non-flippable toolbar', () => {
    // `flippable: false` is a supported param and leaves the popover with no
    // flipper at all, so every flipper touch must stay optional.
    const makeNonFlippable = (): PopoverInline => make({
      items: [ { icon: 'B', name: 'bold', onActivate: vi.fn() } ],
      flippable: false,
    });

    it('builds without a flipper', () => {
      let popover: PopoverInline | undefined;

      expect(() => {
        popover = makeNonFlippable();
      }).not.toThrow();

      expect((popover as unknown as Internal).flipper).toBeUndefined();
      expect(popover!.getElement().querySelector(`[${DATA_ATTR.itemName}="bold"]`)).not.toBeNull();
    });

    it('shows without a flipper, including the deferred re-activation', async () => {
      // The re-activation runs in a microtask, so a throw there never reaches
      // the caller — it lands as an uncaught error instead.
      const escaped: unknown[] = [];
      const onWindowError = (event: Event): void => {
        escaped.push(event);
      };
      const onUncaught = (error: unknown): void => {
        escaped.push(error);
      };

      window.addEventListener('error', onWindowError);
      process.on('uncaughtException', onUncaught);

      try {
        const popover = makeNonFlippable();

        popover.show();

        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(escaped).toEqual([]);
        expect(popover.getElement().getAttribute(DATA_ATTR.popoverOpened)).toBe('true');
      } finally {
        window.removeEventListener('error', onWindowError);
        process.off('uncaughtException', onUncaught);
      }
    });
  });
});
