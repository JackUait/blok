import { describe, it, expect, beforeEach } from 'vitest';

import { PopoverItemSeparator } from '../../../src/components/utils/popover/components/popover-item/popover-item-separator/popover-item-separator';

describe('PopoverItemSeparator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates expected DOM structure on instantiation', () => {
    const separator = new PopoverItemSeparator();
    const element = separator.getElement();

    expect(element).toBeInstanceOf(HTMLElement);
    expect(element.getAttribute('data-blok-testid')).toBe('popover-item-separator');
    expect(element.childElementCount).toBe(1);

    const line = element.firstElementChild as HTMLElement | null;

    expect(line).not.toBeNull();
    expect(line).toBeInstanceOf(HTMLElement);
  });

  it('toggles hidden state on the root element', () => {
    const separator = new PopoverItemSeparator();
    const element = separator.getElement();

    separator.toggleHidden(true);
    expect(element.getAttribute('data-blok-hidden')).toBe('true');

    separator.toggleHidden(false);
    expect(element.hasAttribute('data-blok-hidden')).toBe(false);
  });
});
