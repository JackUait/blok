/**
 * The database block menu's Edit icon (notion-motion.md Round 66 §1): the emoji
 * picker, then the icon before the title.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

interface PickerCall {
  anchor: HTMLElement;
  rect: DOMRect | undefined;
  handlers: { onSelect: (native: string) => void; onRemove: () => void; current?: string; removable?: boolean };
}

const pickers = vi.hoisted(() => ({ opened: [] as unknown[], options: [] as unknown[] }));

vi.mock('../../../../src/tools/callout/emoji-picker', () => ({
  prefetchEmojiPickerData: vi.fn(),
  EmojiPicker: class {
    private readonly element = document.createElement('div');

    constructor(options: unknown) {
      pickers.options.push(options);
    }

    getElement(): HTMLElement {
      return this.element;
    }

    open(anchor: HTMLElement, rect: DOMRect | undefined, handlers: PickerCall['handlers']): Promise<void> {
      pickers.opened.push({ anchor, rect, handlers });

      return Promise.resolve();
    }

    close(): void {}
  },
}));

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  module: { blockManager: { blocks: Block[] } };
}

type Item = { type?: string; name?: string; title?: string; onActivate?: () => unknown };

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settle = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

const database = (extra: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
      ...extra,
    },
  },
];

const boot = async (blocks: OutputBlockData[] = database()): Promise<Runtime> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: structuredClone(blocks) },
  } as never) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const toolItems = (instance: Runtime, id = 'db'): Item[] => {
  const block = instance.module.blockManager.blocks.find(candidate => candidate.id === id);

  if (block === undefined) {
    throw new Error('no database block');
  }

  return (block.getTunes().toolTunes ?? []) as Item[];
};

const lastPicker = (): PickerCall => {
  const call = pickers.opened.at(-1) as PickerCall | undefined;

  if (call === undefined) {
    throw new Error('no picker opened');
  }

  return call;
};

const savedData = async (instance: Runtime): Promise<Record<string, unknown>> =>
  (await instance.save()).blocks.find(block => block.id === 'db')?.data ?? {};

const editIcon = (instance: Runtime): void => {
  toolItems(instance).find(entry => entry.name === 'database-edit-icon')?.onActivate?.();
};

describe('the database block menu\'s Edit icon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickers.opened.length = 0;
    pickers.options.length = 0;
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('comes first in the menu, before Lock database, as in Notion', async () => {
    const instance = await boot();
    const items = toolItems(instance);

    expect(items.slice(0, 2).map(entry => entry.name)).toEqual(['database-edit-icon', 'database-lock']);
    expect(items[0].title).toBe('Edit icon');
  });

  it('puts the picked emoji before the title and saves it', async () => {
    const instance = await boot();

    editIcon(instance);
    expect(lastPicker().handlers.current).toBe('');
    lastPicker().handlers.onSelect('🚀');
    await settle();

    const icon = holder?.querySelector('[data-blok-database-icon]');

    expect(icon?.textContent).toBe('🚀');
    expect(icon?.nextElementSibling?.hasAttribute('data-blok-database-title')).toBe(true);
    expect(await savedData(instance)).toMatchObject({ emoji: '🚀' });
  });

  it('an emoji takes the place of a template\'s glyph icon', async () => {
    const instance = await boot(database({ icon: { glyph: 'check', color: 'green' } }));

    editIcon(instance);
    lastPicker().handlers.onSelect('🚀');
    await settle();

    const saved = await savedData(instance);

    expect(saved.emoji).toBe('🚀');
    expect(saved).not.toHaveProperty('icon');
    expect(holder?.querySelectorAll('[data-blok-database-icon]')).toHaveLength(1);
  });

  it('Remove takes the icon away, emoji or glyph', async () => {
    const instance = await boot(database({ emoji: '🚀' }));

    editIcon(instance);
    expect(lastPicker().handlers.current).toBe('🚀');
    lastPicker().handlers.onRemove();
    await settle();

    expect(holder?.querySelector('[data-blok-database-icon]')).toBeNull();
    expect(await savedData(instance)).not.toHaveProperty('emoji');

    const glyph = await boot(database({ icon: { glyph: 'check', color: 'green' } }));

    editIcon(glyph);
    lastPicker().handlers.onRemove();
    await settle();

    expect(await savedData(glyph)).not.toHaveProperty('icon');
  });

  it('a saved glyph icon still draws as before', async () => {
    await boot(database({ icon: { glyph: 'check', color: 'green' } }));

    expect(holder?.querySelector('[data-blok-database-icon]')?.getAttribute('data-blok-database-icon')).toBe('green');
  });

  // notion-motion.md Round 67 §1: centred under the ⋮⋮ handle, 4px below it.
  it('opens centred under the block\'s ⋮⋮ handle', async () => {
    const instance = await boot();
    const handle = [...document.querySelectorAll<HTMLElement>('[data-blok-settings-toggler]')].at(-1);

    if (handle === undefined) throw new Error('no handle');
    handle.getBoundingClientRect = (): DOMRect => new DOMRect(516, 228, 18, 24);
    editIcon(instance);

    expect(pickers.options.at(-1)).toMatchObject({ centred: true });
    expect(lastPicker().rect).toEqual(new DOMRect(516, 228, 18, 24));
  });

  // notion-motion.md Round 67 §1: 408x356 from the menu; focus stays in Filter while arrows move a highlight.
  it('opens at Notion\'s size, with the arrow keys kept in the search field', async () => {
    editIcon(await boot());

    expect(pickers.options.at(-1)).toMatchObject({ filterKeys: true, size: { width: 408, height: 356 } });
  });

  // notion-motion.md Round 67 §1: Remove shows only once there is an icon.
  it('offers Remove only when the database has an icon', async () => {
    editIcon(await boot());
    expect(lastPicker().handlers.removable).toBe(false);
    editIcon(await boot(database({ emoji: '🚀' })));
    expect(lastPicker().handlers.removable).toBe(true);
    editIcon(await boot(database({ icon: { glyph: 'check', color: 'green' } })));
    expect(lastPicker().handlers.removable).toBe(true);
  });

  // notion-motion.md Round 67 §1: the icon is a button that opens the picker under itself.
  it('clicking the icon opens the picker under it', async () => {
    await boot(database({ emoji: '🚀' }));
    const icon = holder?.querySelector<HTMLElement>('[data-blok-database-icon]');

    expect(icon?.tagName).toBe('BUTTON');
    expect(icon).toHaveAccessibleName('Edit icon');
    icon?.click();

    expect(lastPicker().anchor).toBe(icon);
    expect(lastPicker().rect).toBeUndefined();
    expect(lastPicker().handlers.current).toBe('🚀');
  });

  it('a linked view has no Edit icon: its title is the source\'s', async () => {
    const instance = await boot([...database(), { id: 'linked', type: 'database', data: { title: '', source: { databaseId: 'db' }, views: [], activeViewId: '' } }]);

    expect(toolItems(instance, 'linked').map(entry => entry.name)).not.toContain('database-edit-icon');
  });
});
