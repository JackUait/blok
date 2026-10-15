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

const view = (id: string, name: string): Record<string, unknown> =>
  ({ id, name, type: 'table', position: name, sorts: [], filters: [], visibleProperties: [] });

const database = (id: string, viewIds: [string, string], extra: Record<string, unknown> = {}): OutputBlockData => ({
  id,
  type: 'database',
  data: {
    schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
    views: [view(viewIds[0], 'First'), view(viewIds[1], 'Second')],
    activeViewId: viewIds[0],
    ...extra,
  },
  content: [],
});

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

/** The view id of the selected tab in the database block `blockId`. */
const activeTab = (blockId: string): string | null | undefined =>
  holder?.querySelector(`[data-blok-id="${blockId}"] [data-blok-database-tab][aria-selected="true"]`)?.getAttribute('data-view-id');

const withHash = async (hash: string, run: () => Promise<void>): Promise<void> => {
  window.history.replaceState(null, '', hash);
  try {
    await run();
  } finally {
    window.history.replaceState(null, '', window.location.pathname);
  }
};

describe('database view link (#view-<id>)', () => {
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

  it('copies a link that, on load, selects that view', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await make([database('db', ['a1', 'a2'], { activeViewId: 'a2' })]);
    holder?.querySelector<HTMLElement>('[data-blok-testid="database-toolbar-settings"]')?.click();
    await quiet();
    document.querySelector<HTMLElement>('[data-blok-testid="database-settings-copy-link"]')?.click();
    await quiet();
    const link = String(writeText.mock.calls[0]?.[0]);

    editor?.destroy();
    holder?.replaceChildren();
    await withHash(new URL(link).hash, async () => {
      await make([database('db', ['a1', 'a2'])]);

      expect(activeTab('db')).toBe('a2');
    });
  });

  it('selects the linked view only in the database that owns it', async () => {
    await withHash('#view-b2', async () => {
      await make([database('db-x', ['c1', 'c2']), database('db-y', ['b1', 'b2'])]);

      expect(activeTab('db-y')).toBe('b2');
      expect(activeTab('db-x')).toBe('c1');
    });
  });

  it('selects a linked view\'s own view, and leaves its source alone', async () => {
    await withHash('#view-l2', async () => {
      await make([
        database('src', ['s1', 's2']),
        database('linked', ['l1', 'l2'], { source: { databaseId: 'src' } }),
      ]);

      expect(activeTab('linked')).toBe('l2');
      expect(activeTab('src')).toBe('s1');
    });
  });

  it('keeps the saved view when the link names no view of this database', async () => {
    await withHash('#view-gone', async () => {
      await make([database('db', ['d1', 'd2'], { activeViewId: 'd2' })]);

      expect(activeTab('db')).toBe('d2');
    });
  });

  it('renders the saved view when the fragment is a malformed escape', async () => {
    await withHash('#view-%E0%A4%A', async () => {
      await make([database('db', ['e1', 'e2'])]);

      expect(activeTab('db')).toBe('e1');
    });
  });

  it('applies a link once per page load, so a later render keeps the view the user picked', async () => {
    await withHash('#view-f2', async () => {
      await make([database('db', ['f1', 'f2'])]);

      expect(activeTab('db')).toBe('f2');

      editor?.destroy();
      holder?.replaceChildren();
      await make([database('db', ['f1', 'f2'])]);

      expect(activeTab('db')).toBe('f1');
    });
  });
});
