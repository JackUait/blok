import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Paragraph } from '../../../src/tools/paragraph';
import { CodeTool } from '../../../src/tools/code';
import { DatabaseTool } from '../../../src/tools/database';
import { DatabaseRowTool } from '../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Other tabs only see what reaches the shared Yjs document. These pin two
 * UI changes that write no text, driven the way a user makes them.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  module: {
    yjsManager: {
      getBlockDataObject: (id: string) => Record<string, unknown> | undefined;
    };
  };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      code: CodeTool,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await new Promise(resolve => setTimeout(resolve, 0));

  return instance;
};

const VIEW = (id: string, name: string): Record<string, unknown> => ({
  id,
  name,
  type: 'board',
  position: id === 'v1' ? 'a0' : 'a1',
  groupBy: 'p-status',
  sorts: [],
  filters: [],
  visibleProperties: [],
});

const DATABASE: OutputBlockData = {
  id: 'db',
  type: 'database',
  data: {
    title: 'Tasks',
    schema: [
      { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
      {
        id: 'p-status',
        name: 'Status',
        type: 'select',
        position: 'a1',
        config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] },
      },
    ],
    views: [VIEW('v1', 'Board'), VIEW('v2', 'Second')],
    activeViewId: 'v1',
  },
};

describe('tool state changes reach the shared document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('picking a code block language reaches the shared document', async () => {
    const instance = await boot([{ id: 'c', type: 'code', data: { code: 'x = 1', language: 'javascript' } }]);
    const yjs = instance.module.yjsManager;

    expect(yjs.getBlockDataObject('c')?.language).toBe('javascript');

    const button = holder?.querySelector('[data-blok-testid="code-language-btn"]');

    if (!(button instanceof HTMLElement)) {
      throw new Error('no language button');
    }
    button.click();

    const item = document.querySelector('[data-blok-testid="popover-item"][data-blok-item-name="python"]');

    if (!(item instanceof HTMLElement)) {
      throw new Error('no python item in the language picker');
    }
    item.click();

    expect(holder?.querySelector('[data-blok-testid="code-language-name"]')?.textContent).toBe('Python');
    await vi.waitFor(() => expect(yjs.getBlockDataObject('c')?.language).toBe('python'));
  });

  it('switching a database view reaches the shared document', async () => {
    const instance = await boot([DATABASE]);
    const yjs = instance.module.yjsManager;

    expect(yjs.getBlockDataObject('db')?.activeViewId).toBe('v1');

    const tab = holder?.querySelector('[role="tab"][data-view-id="v2"]');

    if (!(tab instanceof HTMLElement)) {
      throw new Error('no tab for the second view');
    }
    tab.click();

    expect(holder?.querySelector('[role="tab"][data-view-id="v2"]')?.getAttribute('aria-selected')).toBe('true');
    await vi.waitFor(() => expect(yjs.getBlockDataObject('db')?.activeViewId).toBe('v2'));
  });
});
