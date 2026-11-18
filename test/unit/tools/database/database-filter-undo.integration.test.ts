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
   * notion-motion.md Round 65 §2: keys 160ms apart, "no", a pause, "te". A 300ms pause
   * keeps one step; 500ms splits it after "no". The run ends after an idle gap.
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
