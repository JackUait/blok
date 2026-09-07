import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, getByRole, queryByAttribute } from '@testing-library/dom';
import { PopoverItemType } from '../../../types/utils/popover/popover-item-type';
import { PopoverInline } from '../../../src/components/utils/popover/popover-inline';

describe('below-placement children sizing', () => {
  let popover: PopoverInline | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popover?.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it.each([
    { description: 'explicit width', width: '360px', minWidth: undefined, expectedWidth: '360px', expectedMinWidth: '0px' },
    { description: 'explicit minimum width', width: undefined, minWidth: '240px', expectedWidth: 'max-content', expectedMinWidth: '240px' },
    { description: 'both dimensions', width: '24rem', minWidth: '16rem', expectedWidth: '24rem', expectedMinWidth: '16rem' },
    { description: 'auto width with a minimum', width: 'auto', minWidth: '240px', expectedWidth: 'auto', expectedMinWidth: '240px' },
    { description: 'intrinsic link form sizing', width: undefined, minWidth: undefined, expectedWidth: 'max-content', expectedMinWidth: '0px' },
  ])('preserves $description', ({ width, minWidth, expectedWidth, expectedMinWidth }) => {
    const input = document.createElement('input');

    input.setAttribute('aria-label', 'Link destination');
    popover = new PopoverInline({
      items: [{
        title: 'Link',
        children: {
          width,
          minWidth,
          items: [{ type: PopoverItemType.Html, element: input }],
        },
      }],
    });
    document.body.appendChild(popover.getElement());
    popover.show();
    fireEvent.click(getByRole(popover.getElement(), 'menuitem', { name: 'Link' }));

    const nested = queryByAttribute('data-blok-testid', popover.getElement(), 'popover');

    if (!(nested instanceof HTMLElement)) {
      throw new Error('Expected the nested popover');
    }

    const container = queryByAttribute('data-blok-testid', nested, 'popover-container');

    if (!(container instanceof HTMLElement)) {
      throw new Error('Expected the nested popover container');
    }

    expect(container.style.width).toBe(expectedWidth);
    expect(container.style.minWidth).toBe(expectedMinWidth);
    expect(nested).toHaveAttribute('data-side', 'bottom');
    expect(getByRole(nested, 'textbox', { name: 'Link destination' })).toBe(input);
  });
});
