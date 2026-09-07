import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, getByRole, queryByAttribute } from '@testing-library/dom';
import { PopoverInline } from '../../../src/components/utils/popover/popover-inline';

describe('inline dropdown placement', () => {
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
    { placement: undefined, side: 'bottom' },
    { placement: 'beside' as const, side: 'right' },
  ])('opens $placement menus on the $side without losing custom actions', ({ placement, side }) => {
    const chosen = document.createElement('output');

    popover = new PopoverInline({
      items: [{
        title: 'Text',
        name: 'convert-to',
        children: {
          placement,
          items: [{ title: 'Heading', onActivate: () => { chosen.textContent = 'heading'; } }],
        },
      }],
    });
    document.body.appendChild(popover.getElement());
    popover.show();
    fireEvent.click(getByRole(popover.getElement(), 'menuitem', { name: 'Text' }));
    const option = getByRole(popover.getElement(), 'menuitem', { name: 'Heading' });
    const nested = queryByAttribute('data-blok-testid', popover.getElement(), 'popover');

    expect(nested).toHaveAttribute('data-side', side);
    expect(nested).toContainElement(option);
    fireEvent.click(option);
    expect(chosen).toHaveTextContent('heading');
  });
});
