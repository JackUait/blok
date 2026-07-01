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
    expect(items[0]).toHaveAttribute('data-blok-focused', 'true');
    expect(hoistedMocks.canSetCaretMock).toHaveBeenCalledWith(items[0]);
    expect(hoistedMocks.setCursorMock).not.toHaveBeenCalled();
  });

  it('moves focus forward and removes the previous focus class', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.next();
    iterator.next();

    expect(iterator.currentItem).toBe(items[1]);
    expect(items[1]).toHaveAttribute('data-blok-focused', 'true');
    expect(items[0]).not.toHaveAttribute('data-blok-focused');
  });

  it('wraps to the last item when navigating previous from initial state', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.previous();

    const lastItem = items[items.length - 1];

    expect(iterator.currentItem).toBe(lastItem);
    expect(lastItem).toHaveAttribute('data-blok-focused', 'true');
  });

  it('drops cursor and removes focus class from the current item', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.next();
    iterator.dropCursor();

    expect(iterator.currentItem).toBeNull();
    expect(items[0]).not.toHaveAttribute('data-blok-focused');
  });

  it('sets cursor to a specific index when setCursor is called with valid value', () => {
    const items = createItems();
    const iterator = new DomIterator(items, focusedClass);

    iterator.setCursor(1);

    expect(iterator.currentItem).toBe(items[1]);
    expect(items[1]).toHaveAttribute('data-blok-focused', 'true');

    iterator.setCursor(10);

    expect(iterator.currentItem).toBe(items[1]);
    expect(items[1]).toHaveAttribute('data-blok-focused', 'true');
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

  describe('active-descendant host', () => {
    it('sets aria-selected on focused item and aria-activedescendant on host with a generated stable id', () => {
      const items = createItems();
      const host = document.createElement('div');
      const iterator = new DomIterator(items, focusedClass, host);

      iterator.setCursor(0);

      const id = items[0].getAttribute('id');

      expect(id).toBeTruthy();
      expect(items[0]).toHaveAttribute('aria-selected', 'true');
      expect(host).toHaveAttribute('aria-activedescendant', id as string);
    });

    it('accepts host via setActiveDescendantHost setter', () => {
      const items = createItems();
      const host = document.createElement('div');
      const iterator = new DomIterator(items, focusedClass);

      iterator.setActiveDescendantHost(host);
      iterator.setCursor(1);

      const id = items[1].getAttribute('id');

      expect(id).toBeTruthy();
      expect(host).toHaveAttribute('aria-activedescendant', id as string);
    });

    it('moves aria-selected/aria-activedescendant to the new item and clears the old one', () => {
      const items = createItems();
      const host = document.createElement('div');
      const iterator = new DomIterator(items, focusedClass, host);

      iterator.next();
      const firstId = items[0].getAttribute('id');

      expect(host).toHaveAttribute('aria-activedescendant', firstId as string);

      iterator.next();
      const secondId = items[1].getAttribute('id');

      expect(items[0]).not.toHaveAttribute('aria-selected');
      expect(items[1]).toHaveAttribute('aria-selected', 'true');
      expect(host).toHaveAttribute('aria-activedescendant', secondId as string);
    });

    it('clears aria-selected and host aria-activedescendant on dropCursor', () => {
      const items = createItems();
      const host = document.createElement('div');
      const iterator = new DomIterator(items, focusedClass, host);

      iterator.setCursor(0);
      iterator.dropCursor();

      expect(items[0]).not.toHaveAttribute('aria-selected');
      expect(host).not.toHaveAttribute('aria-activedescendant');
    });

    it('clears aria-activedescendant on host and aria-selected on the focused item when host is set to null', () => {
      const items = createItems();
      const host = document.createElement('div');
      const iterator = new DomIterator(items, focusedClass, host);

      iterator.setCursor(0);

      expect(host).toHaveAttribute('aria-activedescendant', items[0].getAttribute('id') as string);
      expect(items[0]).toHaveAttribute('aria-selected', 'true');

      iterator.setActiveDescendantHost(null);

      expect(host).not.toHaveAttribute('aria-activedescendant');
      expect(items[0]).not.toHaveAttribute('aria-selected');
    });

    it('moves aria-activedescendant off the old host onto the new host when swapped while focused', () => {
      const items = createItems();
      const hostA = document.createElement('div');
      const hostB = document.createElement('div');
      const iterator = new DomIterator(items, focusedClass, hostA);

      iterator.setCursor(1);

      const id = items[1].getAttribute('id');

      expect(hostA).toHaveAttribute('aria-activedescendant', id as string);

      iterator.setActiveDescendantHost(hostB);

      expect(hostA).not.toHaveAttribute('aria-activedescendant');
      expect(hostB).toHaveAttribute('aria-activedescendant', id as string);
      expect(items[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('reuses an existing id instead of regenerating it', () => {
      const items = createItems();

      items[0].id = 'preexisting-id';

      const host = document.createElement('div');
      const iterator = new DomIterator(items, focusedClass, host);

      iterator.setCursor(0);

      expect(items[0].id).toBe('preexisting-id');
      expect(host).toHaveAttribute('aria-activedescendant', 'preexisting-id');
    });

    it('does not touch aria-* attributes or generate ids when no host is set', () => {
      const items = createItems();
      const iterator = new DomIterator(items, focusedClass);

      iterator.setCursor(0);
      iterator.next();

      items.forEach((item) => {
        expect(item.hasAttribute('aria-selected')).toBe(false);
        expect(item.hasAttribute('id')).toBe(false);
      });
    });
  });

  describe('Home / End (first / last)', () => {
    it('setCursorToFirst focuses the first item and sets markers', () => {
      const items = createItems();
      const iterator = new DomIterator(items, focusedClass);

      iterator.setCursor(2);
      iterator.setCursorToFirst();

      expect(iterator.currentItem).toBe(items[0]);
      expect(items[0]).toHaveAttribute('data-blok-focused', 'true');
      expect(items[2]).not.toHaveAttribute('data-blok-focused');
    });

    it('setCursorToLast focuses the last item and sets markers', () => {
      const items = createItems();
      const iterator = new DomIterator(items, focusedClass);

      iterator.setCursor(0);
      iterator.setCursorToLast();

      const last = items[items.length - 1];

      expect(iterator.currentItem).toBe(last);
      expect(last).toHaveAttribute('data-blok-focused', 'true');
      expect(items[0]).not.toHaveAttribute('data-blok-focused');
    });

    it('setCursorToFirst/Last update aria-activedescendant on the host', () => {
      const items = createItems();
      const host = document.createElement('div');
      const iterator = new DomIterator(items, focusedClass, host);

      iterator.setCursorToFirst();
      expect(host).toHaveAttribute('aria-activedescendant', items[0].getAttribute('id') as string);

      iterator.setCursorToLast();
      const last = items[items.length - 1];

      expect(host).toHaveAttribute('aria-activedescendant', last.getAttribute('id') as string);
    });
  });

  describe('disabled items', () => {
    it('skips disabled items when moving next', () => {
      const items = createItems();

      items[1].setAttribute('data-blok-disabled', '');

      const iterator = new DomIterator(items, focusedClass);

      iterator.next();
      expect(iterator.currentItem).toBe(items[0]);

      iterator.next();
      expect(iterator.currentItem).toBe(items[2]);
      expect(items[1]).not.toHaveAttribute('data-blok-focused');
    });

    it('skips disabled items when moving previous', () => {
      const items = createItems();

      items[1].setAttribute('data-blok-disabled', '');

      const iterator = new DomIterator(items, focusedClass);

      iterator.previous();
      expect(iterator.currentItem).toBe(items[2]);

      iterator.previous();
      expect(iterator.currentItem).toBe(items[0]);
    });

    it('leaves the cursor unchanged when all items are disabled', () => {
      const items = createItems();

      items.forEach(item => item.setAttribute('data-blok-disabled', ''));

      const iterator = new DomIterator(items, focusedClass);

      iterator.next();

      expect(iterator.currentItem).toBeNull();
    });

    it('setCursorToFirst skips leading disabled items', () => {
      const items = createItems();

      items[0].setAttribute('data-blok-disabled', '');

      const iterator = new DomIterator(items, focusedClass);

      iterator.setCursorToFirst();

      expect(iterator.currentItem).toBe(items[1]);
    });

    it('setCursorToLast skips trailing disabled items', () => {
      const items = createItems();

      items[items.length - 1].setAttribute('data-blok-disabled', '');

      const iterator = new DomIterator(items, focusedClass);

      iterator.setCursorToLast();

      expect(iterator.currentItem).toBe(items[items.length - 2]);
    });
  });
});

