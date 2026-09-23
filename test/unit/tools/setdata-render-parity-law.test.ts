/**
 * Law: a tool's setData(B) either returns false (core then renders the block
 * afresh) or leaves the tool exactly as render(B) would: same DOM, same save().
 *
 * Undo/redo and blocks.update() hand setData the WHOLE stored record. A key
 * missing from it was removed, so merging it over the old data, or updating
 * only the text, leaves stale state on screen and in the document.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Header, type HeaderData } from '../../../src/tools/header';
import { ToggleItem } from '../../../src/tools/toggle';
import type { ToggleItemData } from '../../../src/tools/toggle/types';
import { ListItem } from '../../../src/tools/list';
import type { ListItemData } from '../../../src/tools/list/types';
import type { API } from '../../../types';

vi.mock('../../../src/components/utils/tooltip', () => ({
  show: vi.fn(),
  hide: vi.fn(),
  onHover: vi.fn(),
  destroy: vi.fn(),
}));

const createApi = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: { t: (key: string) => key, has: () => false },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    getChildren: vi.fn().mockReturnValue([]),
    setBlockParent: vi.fn(),
    getById: () => null,
    getBlockIndex: () => 0,
    getCurrentBlockIndex: () => 0,
    getBlockByIndex: () => undefined,
    getBlocksCount: () => 1,
    update: vi.fn().mockResolvedValue(undefined),
  },
} as unknown as API);

interface Tool<T> {
  render: () => HTMLElement;
  save: () => T;
  setData: (data: T) => boolean;
  rendered?: () => void;
}

const build = <T extends Record<string, unknown>>(Ctor: new (options: never) => Tool<T>, data: T): { tool: Tool<T>; root: HTMLElement } => {
  const tool = new Ctor({
    data,
    config: {},
    api: createApi(),
    readOnly: false,
    block: { id: 'b1', dispatchChange: vi.fn() },
  } as never);
  const root = tool.render();

  document.body.appendChild(root);
  tool.rendered?.();

  return { tool, root };
};

/**
 * Markup with class order and counter-made ids left out: a class toggled on
 * later lands at the end, and two renders never share an id.
 */
const markup = (root: HTMLElement): string => {
  const copy = root.cloneNode(true) as HTMLElement;

  [copy, ...Array.from(copy.querySelectorAll('*'))].forEach(el => {
    if (el.hasAttribute('class')) {
      el.setAttribute('class', Array.from(el.classList).sort().join(' '));
    }
  });

  return copy.outerHTML.replace(/(id|aria-labelledby|aria-controls)="[^"]*"/g, '$1=""');
};

const expectSetDataMatchesRender = <T extends Record<string, unknown>>(Ctor: new (options: never) => Tool<T>, from: T, to: T): void => {
  const { tool, root } = build(Ctor, from);

  if (!tool.setData(to)) {
    return;
  }

  const fresh = build(Ctor, to);

  expect(tool.save()).toEqual(fresh.tool.save());
  expect(markup(root)).toBe(markup(fresh.root));
};

describe('setData(B) equals render(B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const HeaderTool = Header as unknown as new (options: never) => Tool<HeaderData>;
  const headerCases: Array<[string, HeaderData, HeaderData]> = [
    ['text', { text: 'One', level: 2 }, { text: 'Two', level: 2 }],
    ['level', { text: 'Head', level: 3 }, { text: 'Head', level: 2 }],
    ['text colour removed', { text: 'Head', level: 2, textColor: 'red' }, { text: 'Head', level: 2 }],
    ['background colour added', { text: 'Head', level: 2 }, { text: 'Head', level: 2, backgroundColor: 'blue' }],
    ['toggle added', { text: 'Head', level: 2 }, { text: 'Head', level: 2, isToggleable: true, isOpen: true }],
    ['toggle removed', { text: 'Head', level: 2, isToggleable: true, isOpen: true }, { text: 'Head', level: 2 }],
    ['toggle closed', { text: 'Head', level: 2, isToggleable: true, isOpen: true }, { text: 'Head', level: 2, isToggleable: true, isOpen: false }],
  ];

  it.each(headerCases)('header: %s', (_name, from, to) => {
    expectSetDataMatchesRender(HeaderTool, from, to);
  });

  const ToggleTool = ToggleItem as unknown as new (options: never) => Tool<ToggleItemData>;
  const toggleCases: Array<[string, ToggleItemData, ToggleItemData]> = [
    ['text', { text: 'One', isOpen: true }, { text: 'Two', isOpen: true }],
    ['closed', { text: 'T', isOpen: true }, { text: 'T', isOpen: false }],
    ['isOpen removed', { text: 'T', isOpen: false }, { text: 'T' }],
  ];

  it.each(toggleCases)('toggle: %s', (_name, from, to) => {
    expectSetDataMatchesRender(ToggleTool, from, to);
  });

  const ListTool = ListItem as unknown as new (options: never) => Tool<ListItemData>;
  const listCases: Array<[string, ListItemData, ListItemData]> = [
    ['text', { text: 'One', style: 'unordered' }, { text: 'Two', style: 'unordered' }],
    ['start removed', { text: 'One', style: 'ordered', start: 5 }, { text: 'One', style: 'ordered' }],
    ['start added', { text: 'One', style: 'ordered' }, { text: 'One', style: 'ordered', start: 5 }],
    ['unchecked', { text: 'Task', style: 'checklist', checked: true }, { text: 'Task', style: 'checklist', checked: false }],
    ['style', { text: 'One', style: 'unordered' }, { text: 'One', style: 'ordered' }],
  ];

  it.each(listCases)('list: %s', (_name, from, to) => {
    expectSetDataMatchesRender(ListTool, from, to);
  });
});
