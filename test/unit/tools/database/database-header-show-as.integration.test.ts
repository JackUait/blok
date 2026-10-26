import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { OutputBlockData } from '../../../../types';

let editor: Blok | undefined;
let holder: HTMLDivElement | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const doc: OutputBlockData[] = [
  {
    id: 'db', type: 'database', content: ['r1'],
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'n', name: 'Amount', type: 'number', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', n: 40 }, position: 'a0' } },
];

const element = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);

  if (found === null) throw new Error('missing fixture element ' + selector);

  return found;
};

const header = (): HTMLElement => element(holder ?? document, '[role="columnheader"][data-property-id="n"]');

describe('the table header Edit property submenu: Show as', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    PopoverRegistry.resetForTests();
    vi.restoreAllMocks();
  });

  // Each write redraws the table under the open menu, so the header it opened from is gone.
  it('picking Bar redraws the menu on the column\'s live header', async () => {
    editor = new Blok({
      holder, dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks: doc },
    });
    await editor.isReady;
    await quiet();
    const opened = header();

    opened.click();
    await quiet();
    element(document, '[data-blok-item-name="editProperty"]').click();
    await quiet();
    element(document, '[data-blok-database-show-as-tile="bar"]').click();
    await quiet();

    const live = header();
    const name = element(document, '[data-blok-database-property-menu-name-input]');

    expect(live).not.toBe(opened);
    expect(PopoverRegistry.instance.triggerOf(name)).toBe(live);
    expect(document.querySelector('[data-blok-item-name="divideBy"]')).not.toBeNull();
  });

  // notion-spec-2 §6: a formula that gives a number has Number's Show as tiles; Ring saves on it.
  it('a number formula offers the Show as tiles, and Ring is saved on the formula', async () => {
    const blocks: OutputBlockData[] = [
      { ...doc[0], data: { ...doc[0].data, schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'n', name: 'Total', type: 'formula', position: 'a1', formula: { expression: '1 + 1' } },
      ] } },
      doc[1],
    ];

    editor = new Blok({
      holder, dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks },
    });
    await editor.isReady;
    await quiet();
    header().click();
    await quiet();
    element(document, '[data-blok-item-name="editProperty"]').click();
    await quiet();
    element(document, '[data-blok-database-show-as-tile="ring"]').click();
    await quiet();

    const saved = await (editor as unknown as { save: () => Promise<{ blocks: OutputBlockData[] }> }).save();
    const schema = (saved.blocks.find((block) => block.id === 'db')?.data as { schema: Array<{ id: string; number?: unknown }> }).schema;

    expect(schema.find((p) => p.id === 'n')?.number).toEqual({ showAs: 'ring', color: 'green' });
  });
});
