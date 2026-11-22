import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API } from '../../../../types';

let editor: Blok | undefined;
let holder: HTMLDivElement | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

describe('a full-page database description in the editor\'s saved data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    await editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  // notion-motion.md Round 99 #7: the new empty line stays on screen, but a reload drops it.
  it('leaves a new empty description out of the save, and keeps a typed one', async () => {
    let api: API | undefined;

    editor = new Blok({
      holder, dataModel: 'hierarchical', pageTitle: true,
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks: [{
        id: 'db', type: 'database',
        data: {
          title: 'Projects', fullPage: true,
          schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] }],
          activeViewId: 'v',
        },
      }] },
      onReady: (readyApi) => { api = readyApi; },
    });
    await editor.isReady;
    await vi.waitFor(() => {
      if (holder?.querySelector(`[${DATA_ATTR.pageHeaderAction}="database-description"]`) === null) throw new Error('no Add description');
    });
    const savedDescription = async (): Promise<unknown> => {
      if (api === undefined) throw new Error('editor did not expose its ready API');
      const block = (await api.saver.save()).blocks.find((b) => b.id === 'db');

      return (block?.data as Record<string, unknown>).description;
    };

    holder?.querySelector<HTMLElement>(`[${DATA_ATTR.pageHeaderAction}="database-description"]`)?.click();
    await quiet();
    const field = holder?.querySelector<HTMLElement>('[data-blok-database-description]');

    field?.blur();
    await quiet();

    expect(field?.isConnected).toBe(true);
    expect(await savedDescription()).toBeUndefined();

    if (field !== null && field !== undefined) field.innerHTML = 'Plan';
    expect(await savedDescription()).toBe('Plan');
  });
});
