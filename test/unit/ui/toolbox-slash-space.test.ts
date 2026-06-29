import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Toolbox } from '../../../src/components/ui/toolbox';
import type { API, BlockAPI } from '@/types';
import type { BlockToolAdapter } from '../../../src/components/tools/block';
import type { ToolsCollection } from '../../../src/components/tools/collection';

/**
 * Creates a mock ToolsCollection with a working forEach implementation.
 */
const createToolsCollection = <T extends BlockToolAdapter>(entries: [string, T][]): ToolsCollection<T> => {
  const map = new Map<string, T>(entries);

  return {
    get: (key: string) => map.get(key),
    has: (key: string) => map.has(key),
    get size(): number {
      return map.size;
    },
    keys: () => map.keys(),
    values: () => map.values(),
    entries: () => map.entries(),
    forEach: (callbackfn: (value: T, key: string, map: Map<string, T>) => void, thisArg?: unknown) => {
      for (const [key, value] of map.entries()) {
        callbackfn.call(thisArg, value, key, map);
      }
    },
    [Symbol.iterator]: () => map[Symbol.iterator](),
  } as unknown as ToolsCollection<T>;
};

const mockPopoverInstance = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
  destroy: vi.fn(),
  getElement: vi.fn(() => document.createElement('div')),
  on: vi.fn(),
  off: vi.fn(),
  hasFocus: vi.fn(() => false),
  filterItems: vi.fn(),
  toggleItemHiddenByName: vi.fn(),
  updatePosition: vi.fn(),
  setLeftAlignElement: vi.fn(),
}));

vi.mock('../../../src/components/dom', () => ({
  Dom: {
    make: vi.fn((tag: string, classNames: string) => {
      const el = document.createElement(tag);

      el.setAttribute('data-blok-testid', classNames);

      return el;
    }),
  },
}));

vi.mock('../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    public show = mockPopoverInstance.show;
    public hide = mockPopoverInstance.hide;
    public destroy = mockPopoverInstance.destroy;
    public getElement = mockPopoverInstance.getElement;
    public on = mockPopoverInstance.on;
    public off = mockPopoverInstance.off;
    public hasFocus = mockPopoverInstance.hasFocus;
    public filterItems = mockPopoverInstance.filterItems;
    public toggleItemHiddenByName = mockPopoverInstance.toggleItemHiddenByName;
    public updatePosition = mockPopoverInstance.updatePosition;
    public setLeftAlignElement = mockPopoverInstance.setLeftAlignElement;
  }

  return {
    PopoverDesktop: MockPopoverDesktop,
    PopoverMobile: MockPopoverDesktop,
  };
});

vi.mock('../../../src/components/utils/shortcuts', () => ({
  Shortcuts: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
    cacheable: (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
  };
});

vi.mock('../../../src/components/selection', () => ({
  SelectionUtils: {
    get rect() {
      return new DOMRect(50, 300, 100, 20);
    },
  },
}));

const i18nLabels: Record<'filter' | 'nothingFound' | 'slashSearchPlaceholder', string> = {
  filter: 'Filter',
  nothingFound: 'Nothing found',
  slashSearchPlaceholder: 'Type to search',
};

const mockI18n = {
  t: vi.fn((key: string) => key),
  has: vi.fn(() => false),
};

describe('Toolbox "/ " (slash + space) dismissal — Notion parity', () => {
  let api: API;
  let tools: ToolsCollection<BlockToolAdapter>;
  let blockAPI: BlockAPI;

  beforeEach(() => {
    vi.clearAllMocks();

    const holderElement = document.createElement('div');
    const contentEditableElement = document.createElement('div');

    contentEditableElement.setAttribute('contenteditable', 'true');
    contentEditableElement.textContent = '';
    holderElement.appendChild(contentEditableElement);

    blockAPI = {
      id: 'test-block-id',
      name: 'testTool',
      isEmpty: true,
      call: vi.fn(),
      holder: holderElement,
    } as unknown as BlockAPI;

    const blockToolAdapter = {
      name: 'testTool',
      toolbox: { title: 'Test Tool', icon: '<svg>test</svg>' },
      shortcut: 'CMD+T',
    } as unknown as BlockToolAdapter;

    tools = createToolsCollection([ ['testTool', blockToolAdapter] ]);

    api = {
      blocks: {
        getCurrentBlockIndex: vi.fn(() => 0),
        getBlockByIndex: vi.fn(() => blockAPI),
        getById: vi.fn(() => null),
        convert: vi.fn(),
        composeBlockData: vi.fn(async () => ({})),
        insert: vi.fn(() => blockAPI),
        update: vi.fn(async () => blockAPI),
        setBlockParent: vi.fn(),
        transact: vi.fn((fn: () => void) => fn()),
        stopBlockMutationWatching: vi.fn(),
      },
      caret: { setToBlock: vi.fn() },
      toolbar: { close: vi.fn() },
      ui: { nodes: { redactor: document.createElement('div') } },
      events: { on: vi.fn(), off: vi.fn() },
    } as unknown as API;
  });

  it('closes the toolbox when a space is typed right after "/" and keeps the literal "/ "', () => {
    const toolbox = new Toolbox({ api, tools, i18nLabels, i18n: mockI18n });

    toolbox.open();
    expect(toolbox.opened).toBe(true);

    const contentEditable = blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

    // The user typed "/" then a space → "/ ".
    contentEditable.textContent = '/ ';
    contentEditable.dispatchEvent(new Event('input', { bubbles: true }));

    // Menu must dismiss, and the typed "/ " must stay in the block (not stripped).
    expect(toolbox.opened).toBe(false);
    expect(contentEditable.textContent).toBe('/ ');
    expect(mockPopoverInstance.filterItems).not.toHaveBeenCalledWith(' ');
  });

  it('keeps filtering normally for a non-space query after "/"', () => {
    const toolbox = new Toolbox({ api, tools, i18nLabels, i18n: mockI18n });

    toolbox.open();

    const contentEditable = blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

    contentEditable.textContent = '/he';
    contentEditable.dispatchEvent(new Event('input', { bubbles: true }));

    expect(toolbox.opened).toBe(true);
    expect(mockPopoverInstance.filterItems).toHaveBeenLastCalledWith('he');
  });
});
