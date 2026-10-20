import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseFavorites, OutputBlockData } from '../../../../types';
import type * as Tooltip from '../../../../src/components/utils/tooltip';

const hover = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/components/utils/tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof Tooltip>();

  return {
    ...actual,
    onHover: (...args: Parameters<typeof actual.onHover>): void => {
      hover(...args);
      actual.onHover(...args);
    },
  };
});

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
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const doc = (mode = 'side'): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], openPagesIn: mode }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (options: { favorites?: DatabaseFavorites; readOnly?: boolean; mode?: string } = {}): Promise<void> => {
  editor = new Blok({
    holder,
    readOnly: options.readOnly ?? false,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config: options.favorites === undefined ? {} : { favorites: options.favorites } },
      'database-row': DatabaseRowTool,
    },
    data: { blocks: doc(options.mode) },
  } as never);
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

const star = (): HTMLElement | null => q('[data-blok-database-peek-favorite]');

/** A host that keeps its list in a Set and answers at once. */
const host = (initial: string[] = []): DatabaseFavorites & { list: Set<string> } => {
  const list = new Set(initial);

  return {
    list,
    isFavorite: vi.fn(({ rowId }: { rowId: string }) => list.has(rowId)),
    onToggle: vi.fn(({ rowId, favorite }: { rowId: string; favorite: boolean }) => {
      if (favorite) list.add(rowId);
      else list.delete(rowId);
    }),
  };
};

describe('row page Favorite star (research/21 §5)', () => {
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

  it('has no star without the host favorites lever', async () => {
    await make();
    await openRow('r1');

    expect(star() === null || star()?.hasAttribute('hidden') === true).toBe(true);
  });

  it('sits right before the Actions button, named "Favorite", with the measured hover hint', async () => {
    await make({ favorites: host() });
    await openRow('r1');
    const button = star();

    expect(button?.hasAttribute('hidden')).toBe(false);
    expect(button?.nextElementSibling?.hasAttribute('data-blok-database-peek-actions')).toBe(true);
    expect(button?.getAttribute('aria-label')).toBe('Favorite');
    expect(hover).toHaveBeenCalledWith(button, 'Add to your favorites');
  });

  it('asks the host when the page opens and shows its answer as aria-pressed', async () => {
    const favorites = host(['r2']);

    await make({ favorites });
    await openRow('r1');
    expect(favorites.isFavorite).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'r1' });
    expect(star()?.getAttribute('aria-pressed')).toBe('false');

    await click(q('[data-blok-database-peek-next]'));
    expect(star()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles through the host and reflects the new state', async () => {
    const favorites = host();

    await make({ favorites });
    await openRow('r1');
    await click(star());

    expect(favorites.onToggle).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'r1', favorite: true });
    expect(star()?.getAttribute('aria-pressed')).toBe('true');

    await click(star());
    expect(favorites.onToggle).toHaveBeenLastCalledWith({ databaseId: 'db', rowId: 'r1', favorite: false });
    expect(star()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('follows a toggle made from the row\'s ⋮⋮ menu while the side peek is open', async () => {
    await make({ favorites: host() });
    await openRow('r1');
    await click(q('[data-row-id="r1"] [data-blok-database-table-row-handle]'));
    await click(document.querySelector('[data-blok-popover-opened] [data-blok-item-name="database-row-favorite"]'));

    expect(star()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows on the full page too', async () => {
    await make({ favorites: host(), mode: 'full' });
    await openRow('r1');

    expect(star()?.hasAttribute('hidden')).toBe(false);
  });

  it('shows for a read-only viewer, since it changes no document', async () => {
    const favorites = host();

    await make({ favorites, readOnly: true });
    await openRow('r1');
    expect(star()?.hasAttribute('hidden')).toBe(false);
    await click(star());
    expect(favorites.onToggle).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'r1', favorite: true });
  });

  it('keeps Add to Favorites out of the page\'s "•••" menu', async () => {
    await make({ favorites: host() });
    await openRow('r1');
    await click(q('[data-blok-database-peek-actions]'));

    const names = [...document.querySelectorAll('[data-blok-popover-opened] [data-blok-item-name]')].map((item) => item.getAttribute('data-blok-item-name'));

    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('database-row-favorite');
  });
});
