import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * notion-motion.md Round 64 §2: adding a filter and picking its value undoes
 * in two steps, the value first, then the chip. Redo walks them back.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void; canUndo: () => boolean; canRedo: () => boolean };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'x', name: 'Note', type: 'text', position: 'a1' },
        { id: 'c', name: 'Done', type: 'checkbox', position: 'a2' },
      ],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', x: 'ab', c: true }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Beta', x: 'zz', c: false }, position: 'a1' } },
];

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const q = (testId: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${testId}"]`);

const click = (testId: string): void => {
  const el = q(testId);

  if (el === null) throw new Error(`no ${testId}`);
  el.click();
};

const order = (): string[] => [...document.querySelectorAll('[data-blok-database-table-row]')].map((row) => row.getAttribute('data-row-id') ?? '');
const chips = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-filter-bar] [data-blok-testid^="database-filter-pill"]')];

const escape = async (): Promise<void> => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await quiet();
};

const addFilter = async (propertyId: string): Promise<void> => {
  click('database-toolbar-filter');
  click(`database-pick-property-${propertyId}`);
  await quiet();
};

describe('view filter undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('undoes a checkbox filter in two steps, the value then the chip, and redoes both', async () => {
    const blok = await make();

    await addFilter('c');
    click('database-filter-checkbox-true');
    await quiet();
    await escape();
    expect(order()).toEqual(['r1']);
    expect(chips()).toHaveLength(1);

    blok.history.undo();
    await quiet();
    expect(order()).toEqual(['r1', 'r2']);
    expect(chips()).toHaveLength(1);

    blok.history.undo();
    await quiet();
    expect(chips()).toHaveLength(0);
    expect(order()).toEqual(['r1', 'r2']);
    expect(blok.history.canUndo()).toBe(false);

    blok.history.redo();
    await quiet();
    expect(chips()).toHaveLength(1);
    expect(order()).toEqual(['r1', 'r2']);

    blok.history.redo();
    await quiet();
    expect(order()).toEqual(['r1']);
  });

  it('undoes typed filter text as one step before the chip', async () => {
    const blok = await make();

    await addFilter('x');
    const input = q('database-filter-value');

    if (!(input instanceof HTMLInputElement)) throw new Error('no value input');
    for (const text of ['a', 'ab']) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => {
        setTimeout(resolve, 50);
      });
    }
    await quiet();
    await escape();
    expect(order()).toEqual(['r1']);

    blok.history.undo();
    await quiet();
    expect(order()).toEqual(['r1', 'r2']);
    expect(chips()).toHaveLength(1);

    blok.history.undo();
    await quiet();
    expect(chips()).toHaveLength(0);
  });

  /**
   * notion-motion.md Round 65 §2, re-read in Round 67 §5: keys 160ms apart, "no", a pause, "te".
   * "note" saves ~620ms after "no" with a 300ms pause (one step) and ~820ms with 500ms (two).
   */
  const typeWithPause = async (pause: number): Promise<HTMLInputElement> => {
    await addFilter('x');
    const input = q('database-filter-value');

    if (!(input instanceof HTMLInputElement)) throw new Error('no value input');
    const wait = (ms: number): Promise<void> => new Promise(resolve => {
      setTimeout(resolve, ms);
    });
    const key = (text: string): void => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    key('n');
    await wait(160);
    key('no');
    await wait(160 + pause);
    key('not');
    await wait(160);
    key('note');
    await wait(1500);
    await escape();

    return input;
  };
  const chipText = (): string => chips()[0]?.textContent ?? '';

  it('keeps typing with a 300ms pause in one step', async () => {
    const blok = await make();

    await typeWithPause(300);
    expect(chipText()).toContain('note');

    blok.history.undo();
    await quiet();

    expect(chips()).toHaveLength(1);
    expect(chipText()).not.toContain('no');
  }, 10000);

  it('splits typing after a 500ms pause, at the pause', async () => {
    const blok = await make();

    await typeWithPause(500);

    blok.history.undo();
    await quiet();

    expect(chipText()).toContain('no');
    expect(chipText()).not.toContain('note');

    blok.history.undo();
    await quiet();

    expect(chips()).toHaveLength(1);
    expect(chipText()).not.toContain('no');
  }, 10000);

  /**
   * notion-motion.md Round 67 §5: the value saves after ~200 ms of idle, and a step takes
   * every save within 700 ms of its first. Keys at a steady gap, read back step by step.
   */
  const typeValue = (value: string): void => {
    const input = q('database-filter-value');

    if (!(input instanceof HTMLInputElement)) throw new Error('no value input');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const typeRun = async (gap: number, text: string): Promise<void> => {
    await addFilter('x');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      for (let i = 1; i <= text.length; i++) {
        typeValue(text.slice(0, i));
        vi.advanceTimersByTime(gap);
      }
      vi.advanceTimersByTime(2000);
    } finally {
      vi.useRealTimers();
    }
    await escape();
  };
  const filterValue = (): string => chipText().split(':').slice(1).join(':').trim().replace(/^Contains\s*/, '');
  const undoValues = async (blok: TestEditor, steps: number): Promise<string[]> => {
    const values: string[] = [];

    for (let i = 0; i < steps; i++) {
      blok.history.undo();
      await quiet();
      values.push(filterValue());
    }

    return values;
  };

  it('keeps keys 160ms apart in one step', async () => {
    const blok = await make();

    await typeRun(160, 'abcdef');
    expect(filterValue()).toBe('abcdef');

    expect(await undoValues(blok, 1)).toEqual(['']);
    expect(chips()).toHaveLength(1);
  });

  it('splits keys 250ms apart into steps of three, like Notion', async () => {
    const blok = await make();

    await typeRun(250, 'abcdfg');
    expect(filterValue()).toBe('abcdfg');

    expect(await undoValues(blok, 2)).toEqual(['abc', '']);
    expect(chips()).toHaveLength(1);
  });

  it('splits keys 500ms apart into steps of two, like Notion', async () => {
    const blok = await make();

    await typeRun(500, 'abc');

    expect(await undoValues(blok, 2)).toEqual(['ab', '']);
    expect(chips()).toHaveLength(1);
  });

  // notion-motion.md Round 66 §3: "ab", an ignored ⌘Z, "cd" with short gaps is one step.
  it('keeps one typing run across an undo key the open popover ignores', async () => {
    const blok = await make();

    await addFilter('x');
    // A write redraws the popover: each key goes to the field now drawn.
    const field = (): HTMLInputElement => {
      const input = q('database-filter-value');

      if (!(input instanceof HTMLInputElement)) throw new Error('no value input');

      return input;
    };
    const key = (text: string): void => {
      field().value = text;
      field().dispatchEvent(new Event('input', { bubbles: true }));
    };

    key('ab');
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(field().value).toBe('ab');
    key('abcd');
    await new Promise(resolve => {
      setTimeout(resolve, 1500);
    });
    await escape();
    expect(chipText()).toContain('abcd');

    blok.history.undo();
    await quiet();

    expect(chips()).toHaveLength(1);
    expect(chipText()).not.toContain('ab');
  }, 10000);

  it('takes typed text still in its run when the undo key comes before the pause', async () => {
    await make();

    await addFilter('x');
    const input = q('database-filter-value');

    if (!(input instanceof HTMLInputElement)) throw new Error('no value input');
    input.value = 'ab';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await escape();
    expect(order()).toEqual(['r1']);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    await quiet();

    expect(order()).toEqual(['r1', 'r2']);
    expect(chips()).toHaveLength(1);
  });

  it('records typed text when its popover closes, before an edit made right after', async () => {
    const blok = await make();

    await addFilter('x');
    const input = q('database-filter-value');

    if (!(input instanceof HTMLInputElement)) throw new Error('no value input');
    input.value = 'ab';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await escape();
    const block = blok.blocks.getById('r1');

    if (block === null) throw new Error('no r1');
    const data = (await block.save())?.data as { properties: Record<string, unknown> };

    await blok.blocks.update('r1', { ...data, properties: { ...data.properties, t: 'Edited' } });
    await quiet();

    blok.history.undo();
    await quiet();

    expect(document.querySelector('[data-blok-database-table-row][data-row-id="r1"]')?.textContent).toContain('Alpha');
    expect(order()).toEqual(['r1']);
  });

  const openAdvanced = async (): Promise<HTMLInputElement> => {
    click('database-toolbar-filter');
    click('database-filter-picker-advanced');
    await quiet();
    const input = document.querySelector('[data-blok-database-filter-rule-value]');

    if (!(input instanceof HTMLInputElement)) throw new Error('no rule value input');

    return input;
  };
  const advancedChip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-filter-bar] [data-blok-testid="database-advanced-pill"]');
  const typeRule = async (texts: string[]): Promise<void> => {
    for (const text of texts) {
      const input = document.querySelector('[data-blok-database-filter-rule-value]');

      if (!(input instanceof HTMLInputElement)) throw new Error('no rule value input');
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => {
        setTimeout(resolve, 50);
      });
    }
    await quiet();
  };

  // notion-motion.md Round 65 §2: typing "Al" in an advanced rule is one step; the next undo removes the filter.
  it('undoes typed advanced rule text as one step before the filter', async () => {
    const blok = await make();

    await openAdvanced();
    await typeRule(['A', 'Al']);
    await escape();
    expect(order()).toEqual(['r1']);

    blok.history.undo();
    await quiet();
    expect(order()).toEqual(['r1', 'r2']);
    expect(advancedChip()).not.toBeNull();

    blok.history.undo();
    await quiet();
    expect(advancedChip()).toBeNull();
  });

  // notion-motion.md Round 65 §2: with a filter popover open, the undo key changes nothing.
  it('ignores the undo key while the advanced filter popover is open', async () => {
    await make();

    await openAdvanced();
    await typeRule(['A', 'Al']);
    const button = document.querySelector<HTMLElement>('[data-blok-testid="database-advanced-filter"] [data-blok-database-filter-rule-button]');

    if (button === null) throw new Error('no rule button');
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    await quiet();

    expect(order()).toEqual(['r1']);
    expect(document.querySelector<HTMLInputElement>('[data-blok-database-filter-rule-value]')?.value).toBe('Al');
  });

  // Round 83 §5 leaves focus on the toolbar Filter button; Round 65 §2: the undo key still changes nothing.
  it('ignores the undo key pressed on the toolbar Filter button while the advanced filter is open', async () => {
    await make();

    await openAdvanced();
    await typeRule(['A', 'Al']);
    await new Promise(resolve => {
      setTimeout(resolve, 700);
    });
    const filter = q('database-toolbar-filter');

    if (filter === null) throw new Error('no toolbar filter button');
    filter.focus();
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    await quiet();

    expect(order()).toEqual(['r1']);
    expect(document.querySelector<HTMLInputElement>('[data-blok-database-filter-rule-value]')?.value).toBe('Al');
  });

  it('ignores the undo key while a filter value popover is open', async () => {
    await make();

    await addFilter('c');
    click('database-filter-checkbox-true');
    await quiet();
    const option = q('database-filter-checkbox-true');

    if (option === null) throw new Error('no option');
    option.focus();
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    await quiet();

    expect(order()).toEqual(['r1']);
    expect(chips()).toHaveLength(1);
  });

  it('keeps the saved document free of personal filters', async () => {
    const blok = await make();

    await addFilter('c');
    click('database-filter-checkbox-true');
    await quiet();
    await escape();
    const saved = await blok.save();
    const views = saved.blocks.find((block) => block.id === 'db')?.data.views as Array<{ filters: unknown[] }>;

    expect(views[0].filters).toEqual([]);
  });

  it('undoes while the filter popover is still open', async () => {
    const blok = await make();

    await addFilter('c');
    click('database-filter-checkbox-true');
    await quiet();

    blok.history.undo();
    await quiet();
    blok.history.undo();
    await quiet();

    expect(chips()).toHaveLength(0);
    expect(order()).toEqual(['r1', 'r2']);
  });
});
