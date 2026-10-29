import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
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
};

const blocks: OutputBlockData[] = [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'n', name: 'Number', type: 'number', position: 'a1' },
        { id: 'f', name: 'Formula', type: 'formula', position: 'a2', formula: { expression: '{{property:n}} * 2' } },
      ],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'A', n: 42 }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'C' }, position: 'a1' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (readOnly = false): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    readOnly,
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks },
  } as never);
  await editor.isReady;
  await quiet();
};

const formulaCell = (): HTMLElement | null | undefined =>
  holder?.querySelector<HTMLElement>('[data-blok-database-table-row][data-row-id="r1"] [role="gridcell"][data-property-id="f"]');

/** notion-spec-2 §18.3 (`formula-editor.png`): a click on a formula cell opens "Edit formula". */
describe('a click on a table formula cell', () => {
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
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('opens the formula editor holding the formula', async () => {
    await make();
    formulaCell()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();

    const field = document.querySelector<HTMLElement>('[data-blok-database-formula-input]');

    expect(field?.querySelector('[data-blok-database-formula-token]')?.getAttribute('data-property')).toBe('Number');
    expect(field?.lastChild?.textContent).toBe(' * 2');
  });

  // notion-spec-2 §22.5: a click on Banana's cell previews "with Banana".
  it('previews with the row that was clicked', async () => {
    await make();
    holder?.querySelector<HTMLElement>('[data-blok-database-table-row][data-row-id="r2"] [role="gridcell"][data-property-id="f"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();

    expect(document.querySelector('[data-blok-database-formula-preview-row]')?.textContent?.trim()).toBe('C');
  });

  // notion-spec-2 §25.1 (31-preview-picker.png): "Preview with" lists every row and previews with the one picked.
  it('previews with a row picked in "Preview with"', async () => {
    await make();
    holder?.querySelector<HTMLElement>('[data-blok-database-table-row][data-row-id="r2"] [role="gridcell"][data-property-id="f"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();
    document.querySelector<HTMLElement>('[data-blok-database-formula-preview-row]')?.click();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-blok-database-formula-preview-option]')];

    expect(rows.map((row) => row.textContent?.trim())).toEqual(['A', 'C']);
    rows[0].click();

    expect(document.querySelector('[data-blok-database-formula-preview]')?.textContent).toBe('84');
  });

  // notion-spec-2 §26.3: Enter inserts the highlighted row. It must not reach the table, which commits and moves down.
  it('Enter in the field inserts the highlighted row and leaves the box open and the table selection alone', async () => {
    await make();
    formulaCell()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();
    const selected = (): string[] =>
      [...(holder?.querySelectorAll('[role="gridcell"][aria-selected="true"]') ?? [])].map((cell) => cell.getAttribute('data-property-id') ?? '');
    const before = selected();
    const field = document.querySelector<HTMLElement>('[data-blok-database-formula-input]');

    field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect(document.querySelector('[data-blok-database-formula-editor]')).not.toBeNull();
    expect(field?.textContent).toContain('* 2 * ');
    expect(selected()).toEqual(before);
  });

  it('opens nothing in a read-only editor', async () => {
    await make(true);
    formulaCell()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();

    expect(document.querySelector('[data-blok-database-formula-editor]')).toBeNull();
  });
});
