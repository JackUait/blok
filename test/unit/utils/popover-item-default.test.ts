import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/components/icons', () => ({
  IconChevronRight: '<svg data-blok-testid="chevron-right"></svg>',
}));

import {
  PopoverItemDefault,
  type PopoverItemDefaultParams
} from '../../../src/components/utils/popover/components/popover-item';
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';

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

  it('invokes onActivate when clicked without confirmation', () => {
    const onActivate = vi.fn();
    const { item, params, element } = createItem({ onActivate });

    item.handleClick();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(params);
    expect(element).not.toHaveAttribute(DATA_ATTR.popoverItemConfirmation);
  });

  it('animates error when onActivate throws', () => {
    const onActivate = vi.fn(() => {
      throw new Error('activation failed');
    });
    const { item, element } = createItem({ onActivate });
    const icon = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');

    expect(icon).not.toBeNull();

    item.handleClick();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(icon?.getAttribute(DATA_ATTR.popoverItemWobble)).toBe('true');

    icon?.dispatchEvent(new Event('animationend'));

    expect(icon?.hasAttribute(DATA_ATTR.popoverItemWobble)).toBe(false);
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

  it('uses reduced right padding when item has children with visible chevron', () => {
    const { element } = createItem({
      children: {
        items: [
          { title: 'Child item', onActivate: vi.fn() },
        ],
      },
    });

    expect(element.className).toContain('pr-2');
    expect(element.className).not.toContain('pr-8');
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
});
