import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverItemDefaultBaseParams } from '../../../../../types/utils/popover/popover-item';

const item = (title: string, name: string): PopoverItemDefaultBaseParams => ({ icon: '<svg></svg>', title, name, onActivate: () => {} });

const header = (popover: PopoverDesktop): HTMLElement | null =>
  popover.getElement().querySelector<HTMLElement>('[data-blok-top-level-group-label]');

describe('"Filtered results" header in the "/" search (N10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const build = (filteredResults?: string): PopoverDesktop => new PopoverDesktop({
    items: [item('Table view', 'tableView'), item('Text', 'text')],
    messages: filteredResults === undefined ? {} : { filteredResults },
  });

  it('shows the label above the matches while a query is typed', () => {
    const popover = build('Filtered results');

    popover.filterItems('table');

    const label = header(popover);

    expect(label?.textContent).toBe('Filtered results');
    expect(label?.nextElementSibling?.getAttribute('data-blok-item-name')).toBe('tableView');
  });

  it('removes the label when the query is cleared', () => {
    const popover = build('Filtered results');

    popover.filterItems('table');
    popover.filterItems('');

    expect(header(popover)).toBeNull();
  });

  it('shows no label when nothing matches', () => {
    const popover = build('Filtered results');

    popover.filterItems('zzzz');

    expect(header(popover)).toBeNull();
  });

  it('leaves a popover without the message unchanged', () => {
    const popover = build();

    popover.filterItems('table');

    expect(header(popover)).toBeNull();
  });
});
