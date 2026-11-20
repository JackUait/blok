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

const doc = (due: string): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1'],
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'd', name: 'Due', type: 'date', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', d: due }, position: 'a0' } },
];

const element = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);

  if (found === null) throw new Error('missing fixture element ' + selector);

  return found;
};

/** Opens the Date column's Edit property flyout and gives its row names. */
const editPropertyRows = async (due: string): Promise<string[]> => {
  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: doc(due) },
  });
  await editor.isReady;
  await quiet();
  element(holder ?? document, '[role="columnheader"][data-property-id="d"]').click();
  await quiet();
  element(document, '[data-blok-item-name="editProperty"]').click();
  await quiet();

  return ['dateFormat', 'timeFormat', 'timeZone', 'dateNotifications']
    .filter((name) => document.querySelector(`[data-blok-item-name="${name}"]`) !== null);
};

// notion-motion.md Round 87 §1 #2, Round 88 §1 #2 (r87-n-dateflyout.raw): with no row holding a time, Notion's
// Date flyout has Date format, Time format and Notifications only. With a timed row it is unread, so the row stays.
describe('the Date column Edit property flyout: Timezone row', () => {
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

  it('has no Timezone row while no row includes a time', async () => {
    expect(await editPropertyRows('2026-11-20')).toEqual(['dateFormat', 'timeFormat', 'dateNotifications']);
  });

  it('keeps the Timezone row once a row includes a time', async () => {
    expect(await editPropertyRows('2026-11-20T09:30')).toEqual(['dateFormat', 'timeFormat', 'timeZone', 'dateNotifications']);
  });
});
