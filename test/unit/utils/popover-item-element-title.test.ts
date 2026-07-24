import { describe, it, expect, vi } from 'vitest';

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
  type PopoverItemDefaultParams,
} from '../../../src/components/utils/popover/components/popover-item';
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';

/**
 * #37: a popover/toolbox item may render a live host element (`titleEl`, a
 * mutation-free node a React adapter portals a ReactNode into) in place of the
 * string title. The element's node identity must be preserved so its external
 * owner keeps controlling it, while the string `title`/`englishTitle` surfaces
 * (used by search/dedup) stay strings and are never stringified from the
 * element.
 */
describe('PopoverItemDefault titleEl host', () => {
  const makeHost = (): HTMLElement => {
    const host = document.createElement('span');

    host.setAttribute('data-blok-mutation-free', 'true');
    host.textContent = 'Заголовок';

    return host;
  };

  it('renders a live host element, preserving node identity', () => {
    const host = makeHost();
    const params: PopoverItemDefaultParams = {
      titleEl: host,
      name: 'quote',
      englishTitle: 'Quote',
      onActivate: vi.fn(),
    };
    const item = new PopoverItemDefault(params);
    const element = item.getElement();

    expect(element).not.toBeNull();

    const titleEl = element?.querySelector(`[${DATA_ATTR.popoverItemTitle}]`);

    expect(titleEl).not.toBeNull();
    // The exact host node is inside the title container (not a stringified copy).
    expect(titleEl?.contains(host)).toBe(true);
    expect(titleEl?.querySelector('[data-blok-mutation-free]')).toBe(host);
  });

  it('keeps search surfaces as strings when only a host element is set', () => {
    const params: PopoverItemDefaultParams = {
      titleEl: makeHost(),
      name: 'quote',
      englishTitle: 'Quote',
      onActivate: vi.fn(),
    };
    const item = new PopoverItemDefault(params);

    // No string title was provided; the English fallback carries the search term.
    expect(item.title).toBeUndefined();
    expect(item.englishTitle).toBe('Quote');
  });

  it('renders the host element in place of a provided string title', () => {
    const host = makeHost();
    const params: PopoverItemDefaultParams = {
      title: 'Fallback',
      titleEl: host,
      name: 'quote',
      onActivate: vi.fn(),
    };
    const item = new PopoverItemDefault(params);
    const titleEl = item.getElement()?.querySelector(`[${DATA_ATTR.popoverItemTitle}]`);

    // The host wins for display, but the string title still backs search.
    expect(titleEl?.contains(host)).toBe(true);
    expect(item.title).toBe('Fallback');
  });

  it('still renders a plain string title', () => {
    const params: PopoverItemDefaultParams = {
      title: 'Plain',
      name: 'plain',
      onActivate: vi.fn(),
    };
    const item = new PopoverItemDefault(params);
    const titleEl = item.getElement()?.querySelector(`[${DATA_ATTR.popoverItemTitle}]`);

    expect(titleEl?.textContent).toBe('Plain');
    expect(item.title).toBe('Plain');
  });
});
