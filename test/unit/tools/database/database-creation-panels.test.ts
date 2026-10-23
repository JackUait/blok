import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IconArrowDownLine } from '../../../../src/components/icons';
import { openLinkedPicker } from '../../../../src/tools/database/database-linked-picker';
import { openNewSourcePanel } from '../../../../src/tools/database/database-new-source-panel';

const popovers = vi.hoisted(() => ({ items: [] as unknown[][] }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    constructor(params: { items?: unknown[] } = {}) {
      popovers.items.push(params.items ?? []);
    }

    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

const panelElement = (testId: string): HTMLElement => {
  const found = (popovers.items as Array<Array<{ element?: HTMLElement }>>)
    .flat()
    .map((item) => item.element)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.getAttribute('data-blok-testid') === testId)
    .at(-1);

  if (found === undefined) throw new Error(`no ${testId}`);
  document.body.appendChild(found);

  return found;
};

const byTestId = (root: ParentNode, id: string): HTMLElement => {
  const found = root.querySelector(`[data-blok-testid="${id}"]`);

  if (!(found instanceof HTMLElement)) throw new Error(`no ${id}`);

  return found;
};

const t = (key: string): string => key;

const sources = [1, 2, 3, 4].map((n) => ({ id: `s${n}`, title: `Source ${n}`, parent: 'Page' }));

const openPicker = (): HTMLElement => {
  const anchor = document.createElement('div');

  document.body.appendChild(anchor);
  openLinkedPicker({
    anchor,
    t,
    sources: () => sources,
    views: () => [],
    newEmpty: vi.fn(),
    pickSource: vi.fn(),
    newTableView: vi.fn(),
    copyView: vi.fn(),
  });

  return panelElement('database-linked-picker');
};

const openNewDatabase = (): HTMLElement => {
  const anchor = document.createElement('div');

  document.body.appendChild(anchor);
  openNewSourcePanel({
    anchor,
    t,
    sources: () => [],
    linkExisting: vi.fn(),
    newDatabase: true,
    importCsv: vi.fn(),
    starters: { list: [{ id: 'tasks', label: 'Tasks Tracker', icon: '<svg></svg>', tint: 'green' }], pick: vi.fn(), more: vi.fn() },
  });

  return panelElement('database-new-database-panel');
};

describe('linked view picker (N19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('has a × in its header', () => {
    const panel = openPicker();

    expect(panel.querySelector('[data-blok-database-panel-close]')).not.toBeNull();
  });

  it('draws a divider under the search', () => {
    const panel = openPicker();
    const search = byTestId(panel, 'database-linked-search');

    expect(search.nextElementSibling?.hasAttribute('data-blok-database-panel-separator')).toBe(true);
  });

  it('puts "New empty data source" in a tile row', () => {
    const panel = openPicker();

    expect(byTestId(panel, 'database-linked-new-empty').hasAttribute('data-blok-database-panel-tiled')).toBe(true);
  });

  it('marks source rows so their glyph draws at 20px', () => {
    const panel = openPicker();

    expect(byTestId(panel, 'database-linked-source-s1').hasAttribute('data-blok-database-source-row')).toBe(true);
  });

  it('shows "Show more" after three sources', () => {
    const panel = openPicker();

    expect(panel.querySelector('[data-blok-testid="database-linked-source-s4"]')).toBeNull();
    expect(panel.querySelector('[data-blok-testid="database-linked-show-more"]')).not.toBeNull();
  });

  it('takes focus back into the search when the insert moves the caret after it opened', () => {
    const frames: FrameRequestCallback[] = [];

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);

      return frames.length;
    });
    const panel = openPicker();
    const elsewhere = document.createElement('input');

    document.body.appendChild(elsewhere);
    elsewhere.focus();
    frames.forEach((callback) => callback(0));

    expect(byTestId(panel, 'database-linked-search')).toHaveFocus();
  });
});

describe('"New database" panel (N03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('puts "New empty data source" in a tile row', () => {
    const panel = openNewDatabase();

    expect(byTestId(panel, 'database-new-source-empty').hasAttribute('data-blok-database-panel-tiled')).toBe(true);
  });

  it('draws Import CSV with a download arrow', () => {
    const panel = openNewDatabase();
    const icon = byTestId(panel, 'database-new-source-csv').querySelector('[data-blok-database-panel-icon]');

    const expected = document.createElement('span');

    expected.innerHTML = IconArrowDownLine;
    expect(icon?.innerHTML).toBe(expected.innerHTML);
  });

  it('gives template rows the tile row height', () => {
    const panel = openNewDatabase();

    expect(byTestId(panel, 'database-new-database-starter-tasks').hasAttribute('data-blok-database-panel-tiled')).toBe(true);
  });
});
