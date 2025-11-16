import { describe, it, expect, vi, afterEach } from 'vitest';

import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverStatesHistory } from '../../../src/components/utils/popover/utils/popover-states-history';

const createItem = (title: string): PopoverItemParams => ({
  title,
  onActivate: vi.fn(),
});

describe('PopoverStatesHistory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns default title and items when no states were pushed', () => {
    const history = new PopoverStatesHistory();

    expect(history.currentTitle).toBe('');
    expect(history.currentItems).toEqual([]);
    expect(history.pop()).toBeUndefined();
  });

  it('pushes states in LIFO order and exposes current title/items', () => {
    const history = new PopoverStatesHistory();
    const rootItems = [ createItem('Root item') ];
    const nestedItems = [ createItem('Nested item') ];

    history.push({
      title: 'Root',
      items: rootItems,
    });

    expect(history.currentTitle).toBe('Root');
    expect(history.currentItems).toBe(rootItems);

    history.push({
      title: 'Nested',
      items: nestedItems,
    });

    expect(history.currentTitle).toBe('Nested');
    expect(history.currentItems).toBe(nestedItems);

    const popped = history.pop();

    expect(popped).toEqual({
      title: 'Nested',
      items: nestedItems,
    });
    expect(history.currentTitle).toBe('Root');
    expect(history.currentItems).toBe(rootItems);
  });

  it('reset keeps the earliest state and removes all newer ones', () => {
    const history = new PopoverStatesHistory();
    const rootItems = [ createItem('Root item') ];
    const nestedItems = [ createItem('Nested item') ];
    const anotherNestedItems = [ createItem('Another nested item') ];

    history.push({
      title: 'Root',
      items: rootItems,
    });
    history.push({
      title: 'Nested',
      items: nestedItems,
    });
    history.push({
      title: 'Another nested',
      items: anotherNestedItems,
    });

    const popSpy = vi.spyOn(history, 'pop');

    history.reset();

    expect(popSpy).toHaveBeenCalledTimes(2);
    expect(history.currentTitle).toBe('Root');
    expect(history.currentItems).toBe(rootItems);
  });
});
