import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import { PopoverItemType } from '../../../../../src/components/utils/popover/components/popover-item';

/** A popover whose rows come from the caller (the page picker), not from its own items. */
describe('PopoverDesktop with caller-owned results', () => {
  let popover: PopoverDesktop;
  let content: HTMLElement;

  const nothingFound = (): HTMLElement | null =>
    popover.getElement().querySelector<HTMLElement>('[data-blok-testid="popover-nothing-found"]');

  beforeEach(() => {
    vi.clearAllMocks();
    content = document.createElement('div');
    popover = new PopoverDesktop({
      items: [{ type: PopoverItemType.Html, element: content }],
      messages: { nothingFound: 'Ничего не найдено' },
    });
    document.body.appendChild(popover.getElement());
  });

  afterEach(() => {
    popover.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows and hides the standard empty state on request, and announces it', () => {
    popover.show();
    expect(nothingFound()?.classList.contains('hidden')).toBe(true);

    popover.setNothingFound(true);

    expect(nothingFound()?.classList.contains('hidden')).toBe(false);
    expect(nothingFound()?.textContent).toContain('Ничего не найдено');
    expect(nothingFound()?.querySelector('[data-blok-media-preview="search"] svg')).not.toBeNull();
    expect(popover.getElement().querySelector('[data-blok-testid="popover-results-announcer"]')?.textContent)
      .toBe('Ничего не найдено');
    expect(content.isConnected).toBe(true);

    popover.setNothingFound(false);

    expect(nothingFound()?.classList.contains('hidden')).toBe(true);
    expect(popover.getElement().querySelector('[data-blok-testid="popover-results-announcer"]')?.textContent).toBe('');
  });

  it('mounts a search field above the empty state and outside the items list', () => {
    const field = document.createElement('div');

    popover.mountSearchField(field);

    const container = popover.getElement().querySelector('[data-blok-popover-container]');

    expect(container?.firstElementChild).toBe(field);
    expect(field.closest('[data-blok-popover-items]')).toBeNull();
    expect(field.classList.contains('mt-(--blok-space-1)')).toBe(true);
  });
});
