import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseViewConfig } from '../../../../src/tools/database/types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  // Past the 130ms submenu open delay.
  await new Promise<void>((resolve) => { setTimeout(resolve, 200); });
};

const doc = (calculations: DatabaseViewConfig['calculations'] = []): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1'],
    data: {
      title: 'Projects',
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'n', name: 'Cost', type: 'number', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [], calculations }],
      activeViewId: 'v1',
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Row', n: 5 }, position: 'a0' } },
];

const make = async (blocks: OutputBlockData[]): Promise<void> => {
  if (holder === undefined) throw new Error('missing editor holder');
  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: { class: DatabaseTool }, 'database-row': DatabaseRowTool },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const must = <T extends Element>(found: T | null | undefined, what: string): T => {
  if (found === null || found === undefined) throw new Error('missing ' + what);

  return found;
};

const openPopovers = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-popover][data-blok-popover-opened="true"]')];

/** The row titled `title` in the last opened menu. */
const row = (title: string): HTMLElement => {
  const menus = openPopovers();
  const last = menus[menus.length - 1];

  return must([...(last?.querySelectorAll<HTMLElement>('[data-blok-popover-item]') ?? [])].find((item) => item.textContent?.trim() === title), `row ${title}`);
};

const savedCalculations = async (): Promise<unknown> => {
  const saved = await editor?.save();

  return (saved?.blocks.find((block) => block.id === 'db')?.data as { views: DatabaseViewConfig[] }).views[0].calculations;
};

describe('a calculation pick closes its menus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.isConnected ? DOMRect.fromRect({ x: 40, y: 100, width: 200, height: 33 }) : DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    PopoverRegistry.resetForTests();
    vi.restoreAllMocks();
  });

  // notion-motion.md Round 81 §1 (r81-n-calc-sumset.raw): header ⌄ › Calculate › More options › Sum leaves no menu open.
  it('from the column header menu, every menu closes', { timeout: 30000 }, async () => {
    await make(doc());
    must(holder?.querySelector<HTMLElement>('[role="columnheader"][data-property-id="n"]'), 'Cost header').click();
    await quiet();
    row('Calculate').click();
    await quiet();
    row('More options').click();
    await quiet();
    expect(openPopovers(), 'header menu, Calculate and More options').toHaveLength(3);

    row('Sum').click();
    await quiet();

    expect(openPopovers()).toHaveLength(0);
    expect(await savedCalculations()).toEqual([expect.objectContaining({ id: 'n', fn: 'sum' })]);
  });

  it('from the footer cell, the menu closes', { timeout: 30000 }, async () => {
    await make(doc([{ id: 'n', fn: 'count' }]));
    must(holder?.querySelector<HTMLElement>('[data-blok-database-table-footer] [data-property-id="n"], [data-property-id="n"][data-blok-database-table-calc]'), 'Cost footer cell').click();
    await quiet();
    row('More options').click();
    await quiet();
    expect(openPopovers(), 'Calculate and More options').toHaveLength(2);

    row('Sum').click();
    await quiet();

    expect(openPopovers()).toHaveLength(0);
    expect(await savedCalculations()).toEqual([expect.objectContaining({ id: 'n', fn: 'sum' })]);
  });
});
