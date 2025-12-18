import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DomIterator } from '../../../src/components/domIterator';

const hoistedMocks = vi.hoisted(() => {
  return {
    canSetCaretMock: vi.fn(),
    setCursorMock: vi.fn(),
    delayMock: vi.fn(),
  };
});

vi.mock('../../../src/components/dom', () => ({
  ['__esModule']: true,
  Dom: {
    canSetCaret: hoistedMocks.canSetCaretMock,
  },
}));

vi.mock('../../../src/components/selection', () => ({
  ['__esModule']: true,
  SelectionUtils: {
    setCursor: hoistedMocks.setCursorMock,
  },
}));

vi.mock('../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../src/components/utils');

  return {
    ...actual,
    delay: hoistedMocks.delayMock,
  };
});

const createItems = (count = 3): HTMLElement[] => {
  return Array.from({ length: count }, (_, index) => {
    const element = document.createElement('button');

    element.textContent = `Item ${index + 1}`;

    return element;
  });
};

describe('DomIterator', () => {
  const focusedClass = 'is-focused';

  beforeEach(() => {
    hoistedMocks.delayMock.mockReset();
    hoistedMocks.delayMock.mockImplementation((method: (...args: unknown[]) => unknown) => {
      return (...args: unknown[]) => {
        method(...args);
      };
    });
    hoistedMocks.canSetCaretMock.mockReset();
    hoistedMocks.canSetCaretMock.mockReturnValue(false);
    hoistedMocks.setCursorMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reports no items when constructed with null list', () => {
    const iterator = new DomIterator(null, focusedClass);

    expect(iterator.hasItems()).toBe(false);
    expect(iterator.currentItem).toBeNull();
  });

  it('updates iterable items via setItems', () => {
    const iterator = new DomIterator([], focusedClass);
    const items = createItems();

    expect(iterator.hasItems()).toBe(false);

    iterator.setItems(items);

    expect(iterator.hasItems()).toBe(true);
    expect(iterator.currentItem).toBeNull();
  });

  it('highlights the first item when moving next from initial state', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.next();

    expect(iterator.currentItem).toBe(items[0]);
    expect(items[0].getAttribute('data-blok-focused')).toBe('true');
    expect(hoistedMocks.canSetCaretMock).toHaveBeenCalledWith(items[0]);
    expect(hoistedMocks.setCursorMock).not.toHaveBeenCalled();
  });

  it('moves focus forward and removes the previous focus class', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.next();
    iterator.next();

    expect(iterator.currentItem).toBe(items[1]);
    expect(items[1].getAttribute('data-blok-focused')).toBe('true');
    expect(items[0].getAttribute('data-blok-focused')).toBeNull();
  });

  it('wraps to the last item when navigating previous from initial state', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.previous();

    const lastItem = items[items.length - 1];

    expect(iterator.currentItem).toBe(lastItem);
    expect(lastItem.getAttribute('data-blok-focused')).toBe('true');
  });

  it('drops cursor and removes focus class from the current item', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.next();
    iterator.dropCursor();

    expect(iterator.currentItem).toBeNull();
    expect(items[0].getAttribute('data-blok-focused')).toBeNull();
  });

  it('sets cursor to a specific index when setCursor is called with valid value', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.setCursor(1);

    expect(iterator.currentItem).toBe(items[1]);
    expect(items[1].getAttribute('data-blok-focused')).toBe('true');

    iterator.setCursor(10);

    expect(iterator.currentItem).toBe(items[1]);
    expect(items[1].getAttribute('data-blok-focused')).toBe('true');
  });

  it('calls SelectionUtils.setCursor via delay when caret can be set', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    hoistedMocks.canSetCaretMock.mockReturnValue(true);

    iterator.next();

    expect(hoistedMocks.delayMock).toHaveBeenCalledWith(expect.any(Function), 50);
    expect(hoistedMocks.setCursorMock).toHaveBeenCalledTimes(1);
    expect(hoistedMocks.setCursorMock).toHaveBeenCalledWith(items[0]);
  });
});

