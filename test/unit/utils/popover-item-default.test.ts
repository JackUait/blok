import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/components/icons', () => ({
  IconChevronRight: '<svg data-blok-testid="chevron-right"></svg>',
}));

import {
  PopoverItemDefault,
  type PopoverItemDefaultParams
} from '../../../src/components/utils/popover/components/popover-item';
import {
  DATA_ATTRIBUTE_ACTIVE,
  DATA_ATTRIBUTE_HIDDEN,
  DATA_ATTRIBUTE_CONFIRMATION,
  DATA_ATTRIBUTE_NO_HOVER,
  DATA_ATTRIBUTE_NO_FOCUS,
  DATA_ATTRIBUTE_FOCUSED,
  DATA_ATTRIBUTE_WOBBLE
} from '../../../src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const';

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

    expect(element.getAttribute('data-blok-testid')).toBe('popover-item');
    expect(element.getAttribute('data-blok-item-name')).toBe(params.name);

    const icon = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-icon"]');
    const title = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-title"]');
    const secondary = element.querySelector<HTMLElement>('[data-blok-testid="popover-item-secondary-title"]');

    expect(icon?.innerHTML).toBe(params.icon);
    expect(title?.innerHTML).toBe(params.title);
    expect(secondary?.textContent).toBe(secondaryLabel);
  });

  it('marks item as active when constructed with isActive=true', () => {
    const { element } = createItem({ isActive: true });

    expect(element.getAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe('true');
  });

  it('toggles active state via toggleActive()', () => {
    const { item, element } = createItem();

    item.toggleActive();
    expect(element.getAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe('true');

    item.toggleActive();
    expect(element.hasAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe(false);

    item.toggleActive(true);
    expect(element.getAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe('true');

    item.toggleActive(false);
    expect(element.hasAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe(false);
  });

  it('toggles hidden state', () => {
    const { item, element } = createItem();

    item.toggleHidden(true);
    expect(element.getAttribute(DATA_ATTRIBUTE_HIDDEN)).toBe('true');

    item.toggleHidden(false);
    expect(element.hasAttribute(DATA_ATTRIBUTE_HIDDEN)).toBe(false);
  });

  it('invokes onActivate when clicked without confirmation', () => {
    const onActivate = vi.fn();
    const { item, params, element } = createItem({ onActivate });

    item.handleClick();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(params);
    expect(element.hasAttribute(DATA_ATTRIBUTE_CONFIRMATION)).toBe(false);
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
    expect(icon?.getAttribute(DATA_ATTRIBUTE_WOBBLE)).toBe('true');

    icon?.dispatchEvent(new Event('animationend'));

    expect(icon?.hasAttribute(DATA_ATTRIBUTE_WOBBLE)).toBe(false);
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
    expect(element.getAttribute(DATA_ATTRIBUTE_CONFIRMATION)).toBe('true');
    expect(element.getAttribute(DATA_ATTRIBUTE_NO_HOVER)).toBe('true');
    expect(element.getAttribute(DATA_ATTRIBUTE_NO_FOCUS)).toBe('true');

    item.handleClick();

    expect(confirmationActivate).toHaveBeenCalledTimes(1);
    expect(confirmationActivate).toHaveBeenCalledWith(confirmation);
    expect(item.isConfirmationStateEnabled).toBe(false);
    expect(element.hasAttribute(DATA_ATTRIBUTE_CONFIRMATION)).toBe(false);
    expect(element.hasAttribute(DATA_ATTRIBUTE_NO_HOVER)).toBe(false);
    expect(element.hasAttribute(DATA_ATTRIBUTE_NO_FOCUS)).toBe(false);
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
    expect(element.hasAttribute(DATA_ATTRIBUTE_CONFIRMATION)).toBe(false);
  });

  it('removes special hover and focus classes on focus', () => {
    const confirmation = {
      title: 'Confirm',
      onActivate: vi.fn(),
    };
    const { item, element } = createItem({ confirmation });

    item.handleClick();
    expect(element.getAttribute(DATA_ATTRIBUTE_NO_HOVER)).toBe('true');
    expect(element.getAttribute(DATA_ATTRIBUTE_NO_FOCUS)).toBe('true');

    item.onFocus();

    expect(element.hasAttribute(DATA_ATTRIBUTE_NO_HOVER)).toBe(false);
    expect(element.hasAttribute(DATA_ATTRIBUTE_NO_FOCUS)).toBe(false);
  });

  it('reflects focus state through isFocused getter', () => {
    const { item, element } = createItem();

    expect(item.isFocused).toBe(false);

    element.setAttribute(DATA_ATTRIBUTE_FOCUSED, 'true');
    expect(item.isFocused).toBe(true);

    element.removeAttribute(DATA_ATTRIBUTE_FOCUSED);
    expect(item.isFocused).toBe(false);
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
