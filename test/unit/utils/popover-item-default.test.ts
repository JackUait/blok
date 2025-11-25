import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@codexteam/icons', () => ({
  IconDotCircle: '<svg data-blok-testid="dot-circle"></svg>',
  IconChevronRight: '<svg data-blok-testid="chevron-right"></svg>',
}));

import {
  PopoverItemDefault,
  type PopoverItemDefaultParams
} from '../../../src/components/utils/popover/components/popover-item';
import {
  css,
  DATA_ATTRIBUTE_ACTIVE
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

    expect(element.classList.contains(css.container)).toBe(true);
    expect(element.getAttribute('data-blok-item-name')).toBe(params.name);

    const icon = element.querySelector<HTMLElement>(`.${css.icon}`);
    const title = element.querySelector<HTMLElement>(`.${css.title}`);
    const secondary = element.querySelector<HTMLElement>(`.${css.secondaryTitle}`);

    expect(icon?.innerHTML).toBe(params.icon);
    expect(title?.innerHTML).toBe(params.title);
    expect(secondary?.textContent).toBe(secondaryLabel);
  });

  it('marks item as active when constructed with isActive=true', () => {
    const { element } = createItem({ isActive: true });

    expect(element.classList.contains(css.active)).toBe(true);
    expect(element.getAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe('true');
  });

  it('toggles active state via toggleActive()', () => {
    const { item, element } = createItem();

    item.toggleActive();
    expect(element.classList.contains(css.active)).toBe(true);
    expect(element.getAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe('true');

    item.toggleActive();
    expect(element.classList.contains(css.active)).toBe(false);
    expect(element.hasAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe(false);

    item.toggleActive(true);
    expect(element.classList.contains(css.active)).toBe(true);
    expect(element.getAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe('true');

    item.toggleActive(false);
    expect(element.classList.contains(css.active)).toBe(false);
    expect(element.hasAttribute(DATA_ATTRIBUTE_ACTIVE)).toBe(false);
  });

  it('toggles hidden state', () => {
    const { item, element } = createItem();

    item.toggleHidden(true);
    expect(element.classList.contains(css.hidden)).toBe(true);

    item.toggleHidden(false);
    expect(element.classList.contains(css.hidden)).toBe(false);
  });

  it('invokes onActivate when clicked without confirmation', () => {
    const onActivate = vi.fn();
    const { item, params, element } = createItem({ onActivate });

    item.handleClick();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(params);
    expect(element.classList.contains(css.confirmationState)).toBe(false);
  });

  it('animates error when onActivate throws', () => {
    const onActivate = vi.fn(() => {
      throw new Error('activation failed');
    });
    const { item, element } = createItem({ onActivate });
    const icon = element.querySelector<HTMLElement>(`.${css.icon}`);

    expect(icon).not.toBeNull();

    item.handleClick();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(icon?.classList.contains(css.wobbleAnimation)).toBe(true);

    icon?.dispatchEvent(new Event('animationend'));

    expect(icon?.classList.contains(css.wobbleAnimation)).toBe(false);
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
    expect(element.classList.contains(css.confirmationState)).toBe(true);
    expect(element.classList.contains(css.noHover)).toBe(true);
    expect(element.classList.contains(css.noFocus)).toBe(true);

    item.handleClick();

    expect(confirmationActivate).toHaveBeenCalledTimes(1);
    expect(confirmationActivate).toHaveBeenCalledWith(confirmation);
    expect(item.isConfirmationStateEnabled).toBe(false);
    expect(element.classList.contains(css.confirmationState)).toBe(false);
    expect(element.classList.contains(css.noHover)).toBe(false);
    expect(element.classList.contains(css.noFocus)).toBe(false);
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
    expect(element.classList.contains(css.confirmationState)).toBe(false);
  });

  it('removes special hover and focus classes on focus', () => {
    const confirmation = {
      title: 'Confirm',
      onActivate: vi.fn(),
    };
    const { item, element } = createItem({ confirmation });

    item.handleClick();
    expect(element.classList.contains(css.noHover)).toBe(true);
    expect(element.classList.contains(css.noFocus)).toBe(true);

    item.onFocus();

    expect(element.classList.contains(css.noHover)).toBe(false);
    expect(element.classList.contains(css.noFocus)).toBe(false);
  });

  it('reflects focus state through isFocused getter', () => {
    const { item, element } = createItem();

    expect(item.isFocused).toBe(false);

    element.classList.add(css.focused);
    expect(item.isFocused).toBe(true);

    element.classList.remove(css.focused);
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

