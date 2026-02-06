import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ListItem } from '../../../../src/tools/list/index';
import { CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';
import type { ListItemData } from '../../../../src/tools/list/types';
import type { ListItemConfig } from '../../../../src/tools/list/types';

/**
 * Creates a minimal mock API for ListItem construction.
 * Only the properties used during construction and keydown handling are needed.
 */
const createMockAPI = (): API => ({
  blocks: {
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
    getBlockByIndex: vi.fn().mockReturnValue(null),
    getBlockIndex: vi.fn().mockReturnValue(0),
    insert: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    update: vi.fn(),
    getRedactor: vi.fn(),
    swap: vi.fn(),
    stretchBlock: vi.fn(),
    insertNewBlock: vi.fn(),
    composeBlockData: vi.fn(),
    render: vi.fn(),
    renderFromHTML: vi.fn(),
    convert: vi.fn(),
  } as unknown as API['blocks'],
  caret: {
    setToFirstBlock: vi.fn(),
    setToLastBlock: vi.fn(),
    setToPreviousBlock: vi.fn(),
    setToNextBlock: vi.fn(),
    setToBlock: vi.fn(),
    focus: vi.fn(),
    updateLastCaretAfterPosition: vi.fn(),
  } as unknown as API['caret'],
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as API['events'],
  i18n: {
    t: vi.fn().mockImplementation((key: string) => key),
  } as unknown as API['i18n'],
  tools: {} as API['tools'],
  listeners: {} as API['listeners'],
  notifier: {} as API['notifier'],
  sanitizer: {} as API['sanitizer'],
  saver: {} as API['saver'],
  selection: {} as API['selection'],
  styles: {} as API['styles'],
  toolbar: {} as API['toolbar'],
  inlineToolbar: {} as API['inlineToolbar'],
  tooltip: {} as API['tooltip'],
  readOnly: {} as API['readOnly'],
  ui: {} as API['ui'],
});

/**
 * Creates a ListItem instance with default data.
 */
const createListItem = (api: API, blockId: string): ListItem => {
  const options: BlockToolConstructorOptions<ListItemData, ListItemConfig> = {
    data: { text: 'Test item', style: 'unordered', checked: false, depth: 0 },
    config: {},
    api,
    readOnly: false,
    block: { id: blockId } as BlockAPI,
  };

  return new ListItem(options);
};

/**
 * Creates a table cell blocks container and places the given element inside it.
 * This simulates a list item rendered inside a table cell.
 */
const wrapInTableCell = (element: HTMLElement): HTMLElement => {
  const cellContainer = document.createElement('div');

  cellContainer.setAttribute(CELL_BLOCKS_ATTR, '');
  cellContainer.appendChild(element);
  document.body.appendChild(cellContainer);

  return cellContainer;
};

describe('ListItem Tab handling inside table cells', () => {
  let api: API;

  beforeEach(() => {
    vi.clearAllMocks();
    api = createMockAPI();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('does not call preventDefault on Tab when inside a table cell', () => {
    const listItem = createListItem(api, 'test-block-1');
    const element = listItem.render();

    wrapInTableCell(element);

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault');

    element.dispatchEvent(tabEvent);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(tabEvent.defaultPrevented).toBe(false);
  });

  it('does not call preventDefault on Shift+Tab when inside a table cell', () => {
    const listItem = createListItem(api, 'test-block-2');
    const element = listItem.render();

    wrapInTableCell(element);

    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(shiftTabEvent, 'preventDefault');

    element.dispatchEvent(shiftTabEvent);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(shiftTabEvent.defaultPrevented).toBe(false);
  });

  it('still calls preventDefault on Tab when NOT inside a table cell', () => {
    const listItem = createListItem(api, 'test-block-3');
    const element = listItem.render();

    document.body.appendChild(element);

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault');

    element.dispatchEvent(tabEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(tabEvent.defaultPrevented).toBe(true);
  });

  it('allows Tab event to bubble up to table cell container without being prevented', () => {
    const listItem = createListItem(api, 'test-block-4');
    const element = listItem.render();
    const cellContainer = wrapInTableCell(element);

    const parentReceivedEvent = { defaultPrevented: true };

    cellContainer.addEventListener('keydown', (e) => {
      parentReceivedEvent.defaultPrevented = e.defaultPrevented;
    });

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });

    element.dispatchEvent(tabEvent);

    // The event should bubble to the parent AND should not have been prevented
    expect(parentReceivedEvent.defaultPrevented).toBe(false);
    expect(tabEvent.defaultPrevented).toBe(false);
  });
});
