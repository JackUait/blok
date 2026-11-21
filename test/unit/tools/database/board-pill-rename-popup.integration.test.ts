import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * notion-motion.md Round 98 §1 #1 (r98-n-pill-space-dump.raw): Enter or Space on a focused
 * column pill opens a rename popup under it, with the name selected and a "Done ↵" button.
 * Escape and Done give focus back to the pill.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const blocks: OutputBlockData[] = [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
      ],
      views: [{ id: 'v', name: 'Board', type: 'board', groupBy: 's', position: 'a0', sorts: [], filters: [], visibleProperties: ['s'] }],
      activeViewId: 'v',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', s: 'o1' }, position: 'a0' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;

const key = async (target: EventTarget, name: string): Promise<void> => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  await quiet();
};

const labels = async (): Promise<string[]> => {
  const db = ((await editor?.save())?.blocks ?? []).find((block) => block.id === 'db');
  const schema = (db?.data as { schema: Array<{ id: string; config?: { options: Array<{ label: string }> } }> }).schema;

  return (schema.find((p) => p.id === 's')?.config?.options ?? []).map((option) => option.label);
};

const pill = (): HTMLElement | null => q('[data-blok-database-column-pill]');
const field = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-blok-database-group-name-field] input');
const done = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-blok-database-group-name-field] [data-blok-database-new-group-done]');

const type = async (value: string): Promise<void> => {
  const input = field();

  if (input === null) throw new Error('no field');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await quiet();
};

const openRename = async (name: string): Promise<void> => {
  pill()?.focus();
  await key(pill() ?? document.body, name);
};

describe('board: column pill rename popup', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks },
    } as never) as unknown as TestEditor;
    await editor.isReady;
    await quiet();
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each(['Enter', ' '])('%j opens the popup with the whole name selected, not an inline field', async (name) => {
    await openRename(name);

    expect(field()).toHaveFocus();
    expect(field()?.value).toBe('Todo');
    expect([field()?.selectionStart, field()?.selectionEnd]).toEqual([0, 4]);
    expect(done()?.textContent).toContain('Done');
    expect(field()?.closest('[data-blok-popover-custom-class~="blok-database-menu"]')).not.toBeNull();
    expect(q('[data-blok-database-column-title-input]')).toBeNull();
  });

  // notion-motion.md Round 99 §1 #1: a click opens the same popup as Enter.
  it('a click opens the popup too, and Done renames the group', async () => {
    pill()?.click();
    await quiet();

    expect(field()).toHaveFocus();
    expect(field()?.value).toBe('Todo');
    expect(q('[data-blok-database-column] input')).toBeNull();

    await type('Review');
    done()?.click();
    await quiet();

    expect(await labels()).toEqual(['Review']);
    await vi.waitFor(() => expect(pill()).toHaveFocus());
  });

  it('Enter in the field renames the group, and the pill takes focus back', async () => {
    await openRename('Enter');
    await type('Review');
    await key(field() ?? document.body, 'Enter');

    expect(await labels()).toEqual(['Review']);
    await vi.waitFor(() => expect(field()).toBeNull());
    expect(pill()?.textContent).toBe('Review');
    expect(pill()).toHaveFocus();
  });

  it('Done renames the group too', async () => {
    await openRename(' ');
    await type('Review');
    done()?.click();
    await quiet();

    expect(await labels()).toEqual(['Review']);
    await vi.waitFor(() => expect(pill()).toHaveFocus());
  });

  // notion-motion.md Round 100 §1 #1 (r100-n-outside-click.raw): a click outside drops the typed name.
  it('a click outside drops a typed name, and the pill takes focus back', async () => {
    pill()?.click();
    await quiet();
    await type('Review');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    // A real mousedown on the page then moves focus to the body.
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.click();
    await quiet();

    await vi.waitFor(() => expect(field()).toBeNull());
    expect(await labels()).toEqual(['Todo']);
    expect(pill()?.textContent).toBe('Todo');
    expect(pill()).toHaveFocus();
  });

  it('a click outside with the name cleared keeps the old name', async () => {
    pill()?.click();
    await quiet();
    await type('  ');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.body.click();
    await quiet();

    await vi.waitFor(() => expect(field()).toBeNull());
    expect(await labels()).toEqual(['Todo']);
  });

  it('Escape keeps the name, and the pill takes focus back', async () => {
    await openRename('Enter');
    await type('Review');
    await key(field() ?? document.body, 'Escape');

    await vi.waitFor(() => expect(field()).toBeNull());
    expect(await labels()).toEqual(['Todo']);
    expect(pill()?.textContent).toBe('Todo');
    expect(pill()).toHaveFocus();
  });
});

/**
 * notion-motion.md Round 99 §1 #2-#4 (r99-n-band-pill-enter.raw, r99-n-select-col-pill-click.raw, r99-n-pill-click.raw):
 * the popup is 240 wide for a Status option and 300 for a Select one, its empty field reads "Rename group",
 * and Enter on a sub-group band pill opens it too.
 */
describe('board: rename popup by property type, and on a band pill', () => {
  const statusGroups = [
    { id: 'todo', kind: 'todo', name: 'To-do', color: 'gray', position: 'a0' },
    { id: 'ip', kind: 'inProgress', name: 'In progress', color: 'blue', position: 'a1' },
    { id: 'c', kind: 'complete', name: 'Complete', color: 'green', position: 'a2' },
  ];
  const schema = [
    { id: 't', name: 'Name', type: 'title', position: 'a0' },
    { id: 'st', name: 'Status', type: 'status', position: 'a1', status: { groups: statusGroups }, config: { options: [{ id: 's1', label: 'Not started', groupId: 'todo', position: 'a0' }] } },
    { id: 'sel', name: 'Select', type: 'select', position: 'a2', config: { options: [{ id: 'red', label: 'Red', position: 'a0' }] } },
    { id: 'ms', name: 'Tags', type: 'multiSelect', position: 'a3', config: { options: [{ id: 'one', label: 'One', position: 'a0' }] } },
  ];
  const mount = async (view: Record<string, unknown>): Promise<void> => {
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: {
        blocks: [
          {
            id: 'db',
            type: 'database',
            data: { schema, views: [{ id: 'v', name: 'Board', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }], activeViewId: 'v' },
            content: ['r1'],
          },
          { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', st: 's1', sel: 'red', ms: ['one'] }, position: 'a0' } },
        ],
      },
    } as never) as unknown as TestEditor;
    await editor.isReady;
    await quiet();
  };
  // jsdom measures 0, so the popover's --width is its minWidth floor.
  const popupWidth = (): string | undefined => field()?.closest<HTMLElement>('[data-blok-popover]')?.style.getPropertyValue('--width');
  const bandPill = (): HTMLElement | null => q('[data-blok-database-board-lane-label][role="button"]');
  const optionLabels = async (propertyId: string): Promise<string[]> => {
    const db = ((await editor?.save())?.blocks ?? []).find((block) => block.id === 'db');
    const saved = (db?.data as { schema: Array<{ id: string; config?: { options: Array<{ label: string }> } }> }).schema;

    return (saved.find((p) => p.id === propertyId)?.config?.options ?? []).map((option) => option.label);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([['st', '240px'], ['sel', '300px'], ['ms', '300px']])('a %s column opens a %s popup', async (groupBy, width) => {
    await mount({ groupBy });
    pill()?.click();
    await quiet();

    expect(field()).toHaveFocus();
    expect(popupWidth()).toBe(width);
  });

  // notion-motion.md Round 101 §1 #4 (r101-n-col-pill-click-escape.raw, r101-n-band-pill-click-escape.raw):
  // Notion's pill button has 3px round the coloured pill, so the popup sits 7 under the coloured pill and 3 left of it.
  describe('places the popup against the coloured pill', () => {
    const popupAt = (): number[] => {
      const popover = field()?.closest<HTMLElement>('[data-blok-popover]');

      return [Number.parseFloat(popover?.style.left ?? ''), Number.parseFloat(popover?.style.top ?? '')];
    };
    const placeAt = (el: Element | null | undefined, x: number, y: number, width: number): void => {
      if (el instanceof HTMLElement) vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(x, y, width, 20));
    };

    it('a column pill: 3 left of it and 7 under it', async () => {
      await mount({ groupBy: 'sel' });
      placeAt(pill(), 550, 323, 102.2);
      pill()?.click();
      await quiet();

      expect(popupAt()).toEqual([547, 350]);
    });

    it('a band pill: 3 left of its coloured pill, as its button already is, and 7 under it', async () => {
      await mount({ groupBy: 'st', subGroupBy: 'sel' });
      const band = bandPill();

      placeAt(band, 563, 373, 43.6);
      placeAt(band?.firstElementChild, 566, 373, 37.6);
      band?.click();
      await quiet();

      expect(popupAt()).toEqual([563, 400]);
    });
  });

  it('the rename field reads "Rename group" when it is empty', async () => {
    await mount({ groupBy: 'sel' });
    pill()?.click();
    await quiet();

    expect(field()?.placeholder).toBe('Rename group');
  });

  it('Enter on a band pill opens a 300 popup under it, and Enter in it renames the sub-group', async () => {
    await mount({ groupBy: 'st', subGroupBy: 'sel' });
    const before = ((await editor?.save())?.blocks ?? []).map((block) => block.id);

    await openBand();

    expect(((await editor?.save())?.blocks ?? []).map((block) => block.id)).toEqual(before);
    expect(field()).toHaveFocus();
    expect(field()?.value).toBe('Red');
    expect(popupWidth()).toBe('300px');

    await type('Crimson');
    await key(field() ?? document.body, 'Enter');

    expect(await optionLabels('sel')).toEqual(['Crimson']);
    await vi.waitFor(() => expect(field()).toBeNull());
    await vi.waitFor(() => expect(bandPill()).toHaveFocus());
    expect(bandPill()?.textContent).toContain('Crimson');
  });

  it('Escape in the band popup keeps the name, and the band pill takes focus back', async () => {
    await mount({ groupBy: 'st', subGroupBy: 'sel' });
    await openBand();
    await type('Crimson');
    await key(field() ?? document.body, 'Escape');

    await vi.waitFor(() => expect(field()).toBeNull());
    expect(await optionLabels('sel')).toEqual(['Red']);
    expect(bandPill()).toHaveFocus();
  });

  // notion-motion.md Round 100 §1 #3-#4 (r100-n-band-pill-click.raw, r100-n-band-pill-space.raw): a click or Space opens the same popup.
  it('a click on a band pill opens the 300 popup, and Done renames the sub-group', async () => {
    await mount({ groupBy: 'st', subGroupBy: 'sel' });
    bandPill()?.click();
    await quiet();

    expect(field()).toHaveFocus();
    expect(field()?.value).toBe('Red');
    expect(popupWidth()).toBe('300px');

    await type('Crimson');
    done()?.click();
    await quiet();

    expect(await optionLabels('sel')).toEqual(['Crimson']);
  });

  it('Space on a band pill opens the popup', async () => {
    await mount({ groupBy: 'st', subGroupBy: 'sel' });
    bandPill()?.focus();
    await key(bandPill() ?? document.body, ' ');

    expect(field()).toHaveFocus();
    expect(field()?.value).toBe('Red');
  });

  async function openBand(): Promise<void> {
    bandPill()?.focus();
    await key(bandPill() ?? document.body, 'Enter');
  }
});
