import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void; canUndo: () => boolean };
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

const doc = (viewOverrides: Record<string, unknown> = {}, titleOverrides: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', ...titleOverrides }, { id: 'due', name: 'Due', type: 'text', position: 'a1' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...viewOverrides }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
  { id: 'r3', type: 'database-row', parent: 'db', data: { properties: { t: 'Three' }, position: 'a2' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[], config: Record<string, unknown> = {}): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;

const click = async (el: Element | null): Promise<void> => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const openRow = (rowId: string): Promise<void> =>
  click(q(`[data-row-id="${rowId}"] [data-blok-database-table-open]`));

const drawer = (): HTMLElement | null => q('[data-blok-database-drawer]');

const shownTitle = (): string | undefined => q<HTMLTextAreaElement>('[data-blok-database-drawer-title]')?.value;

const savedTitle = async (): Promise<Record<string, unknown> | undefined> => {
  const saved = await editor?.save();
  const data = saved?.blocks.find((block) => block.id === 'db')?.data as { schema: Array<Record<string, unknown>> } | undefined;

  return data?.schema.find((property) => property.type === 'title');
};

const item = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-popover-item][data-blok-item-name="${name}"]`);

describe('row page layout through the database tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('saves a pin applied to all pages on the title property', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
    await click(q('[data-blok-database-layout-item-menu][data-property-id="due"]'));
    await click(item('pin'));
    await click(q('[data-blok-database-layout-apply]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [{ id: 'due', place: 'heading' }] });
    expect(q('[data-blok-database-drawer-pins] [data-property-id="due"]')).not.toBeNull();
    expect(drawer()?.isConnected).toBe(true);
  });

  it('adds no undo step for opening Customize layout, and one for Apply', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(q('[data-blok-database-layout-cancel]'));

    expect(editor?.history.canUndo()).toBe(false);
    await click(q('[data-blok-database-drawer-customize]'));
    await click(q('[data-blok-database-layout-item-menu][data-property-id="due"]'));
    await click(item('pin'));
    await click(q('[data-blok-database-layout-apply]'));
    editor?.history.undo();
    await quiet();

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
    expect(editor?.history.canUndo()).toBe(false);
  });

  it('shows the saved layout on every row page', async () => {
    await make(doc({}, { pageLayoutPlacements: [{ id: 'due', place: 'heading' }] }));
    await openRow('r2');

    expect(q('[data-blok-database-drawer-pins] [data-property-id="due"]')).not.toBeNull();
    expect(shownTitle()).toBe('Two');
  });

  it('offers no Customize layout on a locked database', async () => {
    await make(doc({}, { databaseLocked: true }));
    await openRow('r1');

    expect(q('[data-blok-database-drawer-customize]')).toBeNull();
  });
});
