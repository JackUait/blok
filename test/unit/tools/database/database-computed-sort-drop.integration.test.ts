import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { Blok as PublicBlok, OutputBlockData } from '../../../../types';

let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const quiet = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

describe('computed sorting and manual row drops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('keeps the computed order of untouched rows when removing sorting for a drop', async () => {
    const blocks: OutputBlockData[] = [{
      id: 'db', type: 'database', content: ['c', 'a', 'b', 'd'],
      data: {
        schema: [
          { id: 'title', name: 'Name', type: 'title', position: 'a0' },
          { id: 'amount', name: 'Amount', type: 'number', position: 'a1' },
          { id: 'double', name: 'Double', type: 'formula', position: 'a2', formula: { expression: '{{property:amount}} * 2' } },
        ],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [{ propertyId: 'double', direction: 'asc' }], filters: [], visibleProperties: ['amount', 'double'] }],
        activeViewId: 'v',
      },
    }, ...[
      { id: 'c', amount: 30 }, { id: 'a', amount: 10 }, { id: 'b', amount: 20 }, { id: 'd', amount: 40 },
    ].map((row, index): OutputBlockData => ({
      id: row.id, type: 'database-row', parent: 'db',
      data: { position: `a${index}`, properties: { title: row.id.toUpperCase(), amount: row.amount } },
    }))];

    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks },
    }) as unknown as PublicBlok;
    await editor.isReady;
    await quiet();

    const rows = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-database-table-row]') ?? []);

    rows.forEach((row, index) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 38, 800, 38));
    });
    const dragged = rows.find(row => row.getAttribute('data-row-id') === 'd');
    const handle = dragged?.querySelector<HTMLElement>('[data-blok-database-table-row-handle]');

    if (handle === null || handle === undefined) throw new Error('no row drag handle');
    handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 134, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 50, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    handle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const confirm = document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]');

    if (confirm === null) throw new Error('no remove sorting confirmation');
    confirm.click();
    await quiet();

    const saved = await editor.save();
    const positions = saved.blocks.filter(block => block.type === 'database-row').map(block => ({ id: block.id, position: block.data.position }));

    positions.sort((a, b) => String(a.position) < String(b.position) ? -1 : 1);
    expect(positions.map(row => row.id)).toEqual(['a', 'd', 'b', 'c']);
  });
});
