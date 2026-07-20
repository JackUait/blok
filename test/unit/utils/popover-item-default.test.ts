import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/components/icons', () => ({
  IconChevronRight: '<svg data-blok-testid="chevron-right"></svg>',
}));

vi.mock('../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('../../../src/components/utils/logger', () => ({
  log: vi.fn(),
}));

import {
  PopoverItemDefault,
  type PopoverItemDefaultParams
} from '../../../src/components/utils/popover/components/popover-item';
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';
import * as tooltip from '../../../src/components/utils/tooltip';
import { log } from '../../../src/components/utils/logger';

type ItemSetupResult = {
  item: PopoverItemDefault;
  params: PopoverItemDefaultParams;
  element: HTMLElement;
};

const createItem = (overrides: Partial<PopoverItemDefaultParams> = {}): ItemSetupResult => {
  const params: PopoverItemDefaultParams = {
    title: 'Test item',
    name: 'test-item',
    icon: '<svg data-blok-testid="custom-icon"></svg>',
    onActivate: vi.fn(),
    ...overrides,
  };

  const item = new PopoverItemDefault(params);
  const element = item.getElement();

  if (element === null) {
    throw new Error('item root element should be created');
  }

  document.body.appendChild(element);

  return {
    item,
    params,
    element,
  };
};

describe('PopoverItemDefault', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('creates expected DOM structure on instantiation', () => {
    const secondaryLabel = 'Secondary label';
    const { element, params } = createItem({ secondaryLabel });

    expect(element).toHaveAttribute('data-blok-testid', 'popover-item');
    expect(element).toHaveAttribute('data-blok-item-name', params.name);

    const icon = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');
    const title = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-title"]');
    const secondary = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-secondary-title"]');

    expect(icon?.innerHTML).toBe(params.icon);
    expect(title?.innerHTML).toBe(params.title);
    expect(secondary?.textContent).toBe(secondaryLabel);
  });

  it('marks item as active when constructed with isActive=true', () => {
    const { element } = createItem({ isActive: true });

    expect(element).toHaveAttribute(DATA_ATTR.popoverItemActive, 'true');
  });

  it('toggles active state via toggleActive()', () => {
    const { item, element } = createItem();

    item.toggleActive();
    expect(element).toHaveAttribute(DATA_ATTR.popoverItemActive, 'true');

    item.toggleActive();
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemActive);

    item.toggleActive(true);
    expect(element).toHaveAttribute(DATA_ATTR.popoverItemActive, 'true');

    item.toggleActive(false);
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemActive);
  });

  it('toggles hidden state', () => {
    const { item, element } = createItem();

    item.toggleHidden(true);
    expect(element).toHaveAttribute(DATA_ATTR.hidden, 'true');

    item.toggleHidden(false);
    expect(element).not.toHaveAttribute(DATA_ATTR.hidden);
  });

  it('applies animated collapse classes when hiding instead of display:none', () => {
    const { item, element } = createItem();

    item.toggleHidden(true);

    expect(element.classList.contains('opacity-0')).toBe(true);
    expect(element.classList.contains('max-h-0!')).toBe(true);
    expect(element.classList.contains('py-0!')).toBe(true);
    expect(element.classList.contains('mb-0!')).toBe(true);
    expect(element.classList.contains('hidden!')).toBe(false);

    item.toggleHidden(false);

    expect(element.classList.contains('opacity-0')).toBe(false);
    expect(element.classList.contains('max-h-0!')).toBe(false);
    expect(element.classList.contains('py-0!')).toBe(false);
    expect(element.classList.contains('mb-0!')).toBe(false);
  });

  it('invokes onActivate when clicked without confirmation', () => {
    const onActivate = vi.fn();
    const { item, params, element } = createItem({ onActivate });

    item.handleClick();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(params);
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemConfirmation);
  });

  it('exposes a spec-valid keyboard shortcut via aria-keyshortcuts', () => {
    const { element } = createItem({ title: 'Copy', secondaryLabel: '⌘C' });

    // aria-keyshortcuts requires UI-Events key values ("Meta"), not the
    // pretty display names ("Command").
    expect(element).toHaveAttribute('aria-keyshortcuts', 'Meta+C');
  });

  it('formats multi-modifier shortcuts with spec-valid aria-keyshortcuts tokens', () => {
    const { element } = createItem({ title: 'Copy link', secondaryLabel: '⌃⌘L' });

    expect(element).toHaveAttribute('aria-keyshortcuts', 'Control+Meta+L');
  });

  it('does not set aria-keyshortcuts when the item has no shortcut', () => {
    const { element } = createItem();

    expect(element).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('logs rather than swallows an error thrown by onActivate', () => {
    const failure = new Error('activation failed');
    const onActivate = vi.fn(() => {
      throw failure;
    });
    const { item } = createItem({ onActivate });

    expect(() => item.handleClick()).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('onActivate'), 'error', failure);
  });


  it('enters confirmation mode on first click and executes confirmation on second click', () => {
    const confirmationActivate = vi.fn();
    const confirmation = {
      title: 'Confirm',
      onActivate: confirmationActivate,
    };
    const { item, element } = createItem({
      confirmation,
    });

    item.handleClick();
    expect(item.isConfirmationStateEnabled).toBe(true);
    expect(element).toHaveAttribute(DATA_ATTR.popoverItemConfirmation, 'true');
    expect(element).toHaveAttribute(DATA_ATTR.popoverItemNoHover, 'true');
    expect(element).toHaveAttribute(DATA_ATTR.popoverItemNoFocus, 'true');

    item.handleClick();

    expect(confirmationActivate).toHaveBeenCalledTimes(1);
    expect(confirmationActivate).toHaveBeenCalledWith(confirmation);
    expect(item.isConfirmationStateEnabled).toBe(false);
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemConfirmation);
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemNoHover);
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemNoFocus);
  });

  it('resets confirmation state via reset()', () => {
    const confirmation = {
      title: 'Confirm',
      onActivate: vi.fn(),
    };
    const { item, element } = createItem({ confirmation });

    item.handleClick();
    expect(item.isConfirmationStateEnabled).toBe(true);

    item.reset();

    expect(item.isConfirmationStateEnabled).toBe(false);
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemConfirmation);
  });

  it('removes special hover and focus classes on focus', () => {
    const confirmation = {
      title: 'Confirm',
      onActivate: vi.fn(),
    };
    const { item, element } = createItem({ confirmation });

    item.handleClick();
    expect(element).toHaveAttribute(DATA_ATTR.popoverItemNoHover, 'true');
    expect(element).toHaveAttribute(DATA_ATTR.popoverItemNoFocus, 'true');

    item.onFocus();

    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemNoHover);
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemNoFocus);
  });

  it('reflects focus state through isFocused getter', () => {
    const { item, element } = createItem();

    expect(item.isFocused).toBe(false);

    element.setAttribute(DATA_ATTR.focused, 'true');
    expect(item.isFocused).toBe(true);

    element.removeAttribute(DATA_ATTR.focused);
    expect(item.isFocused).toBe(false);
  });

  it('applies destructive attribute when isDestructive is true', () => {
    const { element } = createItem({ isDestructive: true });

    expect(element).toHaveAttribute(DATA_ATTR.popoverItemDestructive, 'true');
  });

  it('does not apply destructive attribute by default', () => {
    const { element } = createItem();

    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemDestructive);
  });

  it('uses symmetric horizontal padding for items without secondary label or chevron', () => {
    const { element } = createItem();

    expect(element.className).toContain('pl-2');
    expect(element.className).toContain('pr-3');
  });

  it('uses symmetric horizontal padding when item has secondary label', () => {
    const { element } = createItem({ secondaryLabel: '#' });

    expect(element.className).toContain('pl-2');
    expect(element.className).toContain('pr-3');
  });

  it('uses symmetric horizontal padding when item has children with visible chevron', () => {
    const { element } = createItem({
      children: {
        items: [
          { title: 'Child item', onActivate: vi.fn() },
        ],
      },
    });

    expect(element.className).toContain('pl-2');
    expect(element.className).toContain('pr-3');
  });

  it('exposes toggle, title and disabled getters', () => {
    const toggleValue = 'group-1';
    const customTitle = 'Custom title';
    const { item } = createItem({
      toggle: toggleValue,
      title: customTitle,
      isDisabled: true,
    });

    expect(item.toggle).toBe(toggleValue);
    expect(item.title).toBe(customTitle);
    expect(item.isDisabled).toBe(true);
  });

  it('removes icon background in inline context', () => {
    const item = new PopoverItemDefault(
      {
        title: 'Bold',
        name: 'bold',
        icon: '<svg></svg>',
        onActivate: vi.fn(),
      },
      { isInline: true, iconWithGap: true }
    );
    const element = item.getElement()!;

    document.body.appendChild(element);

    const icon = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');

    expect(icon).not.toBeNull();
    expect(icon?.className).not.toContain('bg-popover-icon-bg');
  });

  it('keeps icon background in non-inline context', () => {
    const { element } = createItem();
    const icon = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');

    expect(icon).not.toBeNull();
    expect(icon?.className).toContain('bg-popover-icon-bg');
  });

  it('prevents icon container from shrinking in flex layout', () => {
    const { element } = createItem();
    const icon = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');

    expect(icon).not.toBeNull();
    expect(icon?.className).toContain('shrink-0');
  });

  it('prevents secondary label from shrinking so shortcuts stay right-aligned', () => {
    const { element } = createItem({ secondaryLabel: '#####' });
    const secondary = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-secondary-title"]');

    expect(secondary).not.toBeNull();
    expect(secondary?.className).toContain('shrink-0');
  });

  it('suppresses native focus outline so only keyboard-driven focus styles show', () => {
    const { element } = createItem();

    // outline-hidden removes the browser default focus ring; custom focus styles
    // are applied via the data-blok-focused attribute instead.
    expect(element.className).toContain('outline-hidden');
  });

  it('does not truncate title text when secondary label is present', () => {
    const { element } = createItem({ secondaryLabel: '#####' });
    const title = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-title"]');

    expect(title).not.toBeNull();
    expect(title?.className).not.toContain('overflow-hidden');
    expect(title?.className).not.toContain('text-ellipsis');
    expect(title?.className).not.toContain('min-w-0');
    expect(title?.className).toContain('whitespace-nowrap');
  });

  it('registers tooltip on hover for secondary label showing only the readable shortcut', () => {
    const { element } = createItem({ title: 'Copy', secondaryLabel: '⌘C' });
    const secondary = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-secondary-title"]');

    expect(secondary).not.toBeNull();

    // Tooltip is anchored to the inner glyph span, not the outer padded container,
    // so it centers directly over the visible shortcut keys.
    const glyphSpan = secondary?.firstElementChild as HTMLElement | undefined;
    const call = vi.mocked(tooltip.onHover).mock.calls.find(([el]) => el === glyphSpan);

    expect(call).toBeDefined();
    expect(call?.[1]).toBe('Command+C');
    expect(call?.[2]).toEqual(expect.objectContaining({ placement: 'top' }));
  });

  it('does not register secondary label tooltip when item has no secondaryLabel', () => {
    vi.mocked(tooltip.onHover).mockClear();
    createItem({ title: 'Copy' });

    // onHover may have been called for hint registration, but NOT with the secondary element
    const anyCallHasSecondaryArg = vi.mocked(tooltip.onHover).mock.calls.some(([el]) => {
      return el instanceof HTMLElement && el.getAttribute('data-blok-testid') === 'popover-item-secondary-title';
    });

    expect(anyCallHasSecondaryArg).toBe(false);
  });

  describe('ARIA roles', () => {
    it('exposes a plain actionable item as role="menuitem"', () => {
      const { element } = createItem({ title: 'Copy' });

      expect(element.getAttribute('role')).toBe('menuitem');
    });

    it('exposes a toggleable item as role="menuitemcheckbox" with aria-checked reflecting state', () => {
      const item = new PopoverItemDefault({
        title: 'Bold',
        name: 'bold',
        toggle: true,
        isActive: true,
        onActivate: vi.fn(),
      });
      const element = item.getElement();

      if (element === null) {
        throw new Error('root element expected');
      }

      expect(element.getAttribute('role')).toBe('menuitemcheckbox');
      expect(element.getAttribute('aria-checked')).toBe('true');
    });

    it('defaults aria-checked to false for an inactive toggleable item', () => {
      const item = new PopoverItemDefault({
        title: 'Bold',
        name: 'bold',
        toggle: true,
        onActivate: vi.fn(),
      });
      const element = item.getElement();

      if (element === null) {
        throw new Error('root element expected');
      }

      expect(element.getAttribute('role')).toBe('menuitemcheckbox');
      expect(element.getAttribute('aria-checked')).toBe('false');
    });

    it('updates aria-checked when the active state toggles', () => {
      const item = new PopoverItemDefault({
        title: 'Bold',
        name: 'bold',
        toggle: true,
        onActivate: vi.fn(),
      });
      const element = item.getElement();

      if (element === null) {
        throw new Error('root element expected');
      }

      item.toggleActive(true);
      expect(element.getAttribute('aria-checked')).toBe('true');

      item.toggleActive(false);
      expect(element.getAttribute('aria-checked')).toBe('false');
    });

    it('exposes a listbox option via the menuItemRole render param', () => {
      const item = new PopoverItemDefault(
        { title: 'Heading', name: 'header', onActivate: vi.fn() },
        { menuItemRole: 'option' }
      );
      const element = item.getElement();

      if (element === null) {
        throw new Error('root element expected');
      }

      expect(element.getAttribute('role')).toBe('option');
      expect(element).not.toBeChecked();
    });

    it('promotes a checkbox item to role="menuitemradio" via useRadioRole() and keeps aria-checked', () => {
      const item = new PopoverItemDefault({
        title: 'Left',
        name: 'left',
        toggle: 'align',
        isActive: true,
        onActivate: vi.fn(),
      });
      const element = item.getElement();

      if (element === null) {
        throw new Error('root element expected');
      }

      expect(element.getAttribute('role')).toBe('menuitemcheckbox');

      item.useRadioRole();

      expect(element.getAttribute('role')).toBe('menuitemradio');
      expect(element.getAttribute('aria-checked')).toBe('true');
    });

    it('keeps aria-checked in sync on a menuitemradio item when toggling active', () => {
      const item = new PopoverItemDefault({
        title: 'Left',
        name: 'left',
        toggle: 'align',
        onActivate: vi.fn(),
      });
      const element = item.getElement();

      if (element === null) {
        throw new Error('root element expected');
      }

      item.useRadioRole();
      expect(element.getAttribute('aria-checked')).toBe('false');

      item.toggleActive(true);
      expect(element.getAttribute('aria-checked')).toBe('true');

      item.toggleActive(false);
      expect(element.getAttribute('aria-checked')).toBe('false');
    });

    it('leaves a listbox option untouched when useRadioRole() is called', () => {
      const item = new PopoverItemDefault(
        { title: 'Heading', name: 'header', toggle: 'align', onActivate: vi.fn() },
        { menuItemRole: 'option' }
      );
      const element = item.getElement();

      if (element === null) {
        throw new Error('root element expected');
      }

      item.useRadioRole();

      expect(element.getAttribute('role')).toBe('option');
    });

    it('marks a disabled item with aria-disabled', () => {
      const { element } = createItem({ title: 'Copy', isDisabled: true });

      expect(element.getAttribute('aria-disabled')).toBe('true');
    });

    it('hides decorative icon and chevron from assistive tech', () => {
      const item = new PopoverItemDefault({
        title: 'Convert',
        name: 'convert',
        icon: '<svg data-blok-testid="custom-icon"></svg>',
        children: { items: [{ title: 'Child', name: 'child', onActivate: vi.fn() }] },
      });
      const element = item.getElement();

      if (element === null) {
        throw new Error('root element expected');
      }

      const icon = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');
      const chevron = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-chevron-right"]');

      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('HTMLElement icon (live element, not an innerHTML string)', () => {
    const createElementIcon = (): HTMLElement => {
      const iconNode = document.createElement('span');

      iconNode.setAttribute('data-blok-testid', 'live-icon');

      return iconNode;
    };

    it('appends the SAME element node into the icon container (identity preserved, no clone)', () => {
      const iconNode = createElementIcon();
      const { element } = createItem({ icon: iconNode });

      const iconContainer = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');

      expect(iconContainer).not.toBeNull();
      // Node IDENTITY matters: a live renderer (e.g. a React portal target)
      // must keep owning this exact node — an innerHTML clone would orphan it.
      expect(iconContainer?.firstChild).toBe(iconNode);
      expect(iconContainer?.childNodes).toHaveLength(1);
    });

    it('confirmation-state updateIcon with a string does not clobber a live element icon', () => {
      const iconNode = createElementIcon();
      const confirmation = {
        title: 'Confirm',
        icon: '<svg data-blok-testid="confirm-icon"></svg>',
        onActivate: vi.fn(),
      };
      const { item, element } = createItem({ icon: iconNode, confirmation });

      item.handleClick();
      expect(item.isConfirmationStateEnabled).toBe(true);

      const iconContainer = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');

      // The live element stays mounted — stringifying over it would detach the
      // node a live renderer still owns.
      expect(iconContainer?.firstChild).toBe(iconNode);
    });

    it('restores the SAME element node when leaving confirmation state', () => {
      const iconNode = createElementIcon();
      const confirmation = {
        title: 'Confirm',
        onActivate: vi.fn(),
      };
      const { item, element } = createItem({ icon: iconNode, confirmation });

      item.handleClick();
      item.reset();

      const iconContainer = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');

      expect(iconContainer?.firstChild).toBe(iconNode);
      expect(iconContainer?.childNodes).toHaveLength(1);
    });

    it('confirmation-state updateIcon with an element swaps to that exact node and restore brings the original back', () => {
      const iconNode = createElementIcon();
      const confirmIconNode = document.createElement('em');
      const confirmation = {
        title: 'Confirm',
        icon: confirmIconNode,
        onActivate: vi.fn(),
      };
      const { item, element } = createItem({ icon: iconNode, confirmation });

      item.handleClick();

      const iconContainer = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');

      expect(iconContainer?.firstChild).toBe(confirmIconNode);

      item.reset();
      expect(iconContainer?.firstChild).toBe(iconNode);
    });
  });
});
