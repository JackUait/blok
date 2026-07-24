import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import { ListItem } from '../../src/tools/list';
import type { OutputData } from '../../types';

/**
 * The sharpest trap in the migration surface: `config.migrations` used to run at
 * composeBlock time — AFTER the renderer analyzed the document's format. With
 * `dataModel: 'auto'` (the default), the analysis then still reported `legacy`,
 * so the SAVE path collapsed the document back to nested Editor.js `items[]` —
 * quietly undoing the host's migration on the very next round-trip.
 *
 * This is the end-to-end proof, through a real editor: load legacy data, upgrade
 * it with a host rule, save, and assert the saved document is in the migrated
 * (flat) shape rather than the legacy nested one.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

describe('config.migrations + dataModel: auto round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('saves the migrated shape, not the pre-migration legacy shape', async () => {
    const instance = new Blok({
      holder,
      dataModel: 'auto',
      tools: { paragraph: Paragraph, list: ListItem },
      migrations: {
        // The host already moved this tool's storage to Blok's flat list shape;
        // the stored document is still in the Editor.js nested shape.
        list: (data) => {
          const items = (data as { items?: Array<{ content: string }> }).items;

          return Array.isArray(items)
            ? { text: items[0]?.content ?? '', style: 'unordered' }
            : data;
        },
      },
      data: {
        blocks: [
          {
            id: 'l1',
            type: 'list',
            data: { style: 'unordered', items: [{ content: 'migrated item', items: [] }] },
          },
        ],
      },
    }) as unknown as TestEditor;

    editor = instance;

    await instance.isReady;

    const saved = await instance.save();
    const listBlock = saved.blocks.find((block) => block.type === 'list');

    expect(listBlock?.data.text).toBe('migrated item');
    // The legacy nested container must NOT come back: 'auto' saw the migrated
    // (flat) shape, so it preserves that shape instead of collapsing.
    expect(listBlock?.data.items).toBeUndefined();
  }, 60_000);
});
