import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ListItem } from '../../../../src/tools/list';
import { ToggleItem } from '../../../../src/tools/toggle';
import { CalloutTool } from '../../../../src/tools/callout';
import { ColumnList } from '../../../../src/tools/column-list';
import { Column } from '../../../../src/tools/column';
import { Table } from '../../../../src/tools/table';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

const P = (id: string, parent?: string): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: `Paragraph ${id}` },
  ...(parent !== undefined ? { parent } : {}),
});

/** Every first-party container, each with a child nested under a slotless child. */
const nestedDocument: OutputBlockData[] = [
  { id: 'tog', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['tp1'] },
  { ...P('tp1', 'tog'), content: ['tp2'] },
  P('tp2', 'tp1'),
  { id: 'hplain', type: 'header', data: { text: 'Plain', level: 2 }, content: ['hpc'] },
  P('hpc', 'hplain'),
  { id: 'htog', type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true, isOpen: true }, content: ['htc'] },
  P('htc', 'htog'),
  { id: 'cal', type: 'callout', data: { text: 'Callout' }, content: ['cc1'] },
  { ...P('cc1', 'cal'), content: ['cc2'] },
  P('cc2', 'cc1'),
  { id: 'l1', type: 'list', data: { text: 'item', style: 'unordered' }, content: ['l2'] },
  { id: 'l2', type: 'list', data: { text: 'nested item', style: 'unordered' }, parent: 'l1' },
  { id: 'cl', type: 'column_list', data: {}, content: ['col1', 'col2'] },
  { id: 'col1', type: 'column', data: {}, parent: 'cl', content: ['c1p'] },
  P('c1p', 'col1'),
  { id: 'col2', type: 'column', data: {}, parent: 'cl', content: ['c2p'] },
  P('c2p', 'col2'),
  { id: 'tbl', type: 'table', data: { withHeadings: false, content: [['a', 'b'], ['c', 'd']] } },
  P('end'),
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      header: Header,
      list: ListItem,
      toggle: ToggleItem,
      callout: CalloutTool,
      column_list: ColumnList,
      column: Column,
      table: Table,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const holderOf = (id: string): HTMLElement => {
  const element = holder?.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);

  if (element === null || element === undefined) {
    throw new Error(`no holder for ${id}`);
  }

  return element;
};

describe('Saver tree placement gate on a real editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('saves every first-party container without a placement violation', async () => {
    const instance = await createEditor(nestedDocument);

    const saved = await instance.save();

    expect(saved.blocks.map(block => block.id).filter(id => nestedDocument.some(b => b.id === id)))
      .toEqual(nestedDocument.map(block => block.id));
  }, 60_000);

  it('rejects the save when a block nested under a slotless toggle child sits at the editor root', async () => {
    const instance = await createEditor(nestedDocument);
    const toggleHolder = holderOf('tog');

    toggleHolder.after(holderOf('tp2'));

    await expect(instance.save()).rejects.toThrow(/Block tp2 .*outside its home slot/);
  }, 60_000);
});
