import { describe, it, expect, beforeEach } from 'vitest';

import { PopoverItemSeparator } from '../../../src/components/utils/popover/components/popover-item/popover-item-separator/popover-item-separator';
import { css } from '../../../src/components/utils/popover/components/popover-item/popover-item-separator/popover-item-separator.const';

describe('PopoverItemSeparator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates expected DOM structure on instantiation', () => {
    const separator = new PopoverItemSeparator();
    const element = separator.getElement();

    expect(element).toBeInstanceOf(HTMLElement);
    expect(element.classList.contains(css.container)).toBe(true);
    expect(element.childElementCount).toBe(1);

    const line = element.firstElementChild as HTMLElement | null;

    expect(line).not.toBeNull();
    expect(line?.classList.contains(css.line)).toBe(true);
  });

  it('toggles hidden class on the root element', () => {
    const separator = new PopoverItemSeparator();
    const element = separator.getElement();

    separator.toggleHidden(true);
    expect(element.classList.contains(css.hidden)).toBe(true);

    separator.toggleHidden(false);
    expect(element.classList.contains(css.hidden)).toBe(false);
  });
});
