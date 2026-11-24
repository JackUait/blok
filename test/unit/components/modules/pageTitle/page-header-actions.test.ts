import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Blok as PublicBlok, BlokConfig, BlockTool, PageHeaderAction } from '../../../../../types';

const activate = vi.fn();
const state = { label: 'Add description' };

class Asking implements BlockTool {
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public setReadOnly(): void {}

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }

  public pageHeaderActions(): PageHeaderAction[] {
    return [{ name: 'asking', label: state.label, onActivate: () => {
      activate();
      state.label = 'Hide description';
    } }];
  }
}

/** Stands in for a full-page database: the database tool puts this attribute on its root when `fullPage`. */
class FullPageDatabase extends Asking {
  public render(): HTMLElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-page', '');

    return root;
  }
}

const create = (config: Partial<BlokConfig>): PublicBlok =>
  new Blok({ tools: {
    paragraph: { class: Paragraph },
    asking: { class: Asking as never },
    fullDb: { class: FullPageDatabase as never },
  }, ...config }) as unknown as PublicBlok;

/** Renderer emits BlocksRendered from requestIdleCallback, after isReady. */
const rendered = async (): Promise<void> => {
  await vi.waitFor(() => {
    if (document.querySelector(`[${DATA_ATTR.rendered}]`) === null) {
      throw new Error('not rendered');
    }
  });
};

describe('page header actions', () => {
  let holder: HTMLDivElement;
  let blok: PublicBlok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    state.label = 'Add description';
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  const header = (): HTMLElement => {
    const found = holder.querySelector<HTMLElement>(`[${DATA_ATTR.pageHeader}]`);

    if (found === null) {
      throw new Error('no header');
    }

    return found;
  };
  const actions = (): HTMLButtonElement[] => [...holder.querySelectorAll<HTMLButtonElement>(`[${DATA_ATTR.pageHeaderAction}]`)];

  // notion-motion.md Round 98 §1 #5: the button is there before the first hover, so it fades in with Add icon and Add cover.
  it('draws the first block\'s buttons once the blocks render, before any hover, and runs the button', async () => {
    blok = create({ holder, pageTitle: true, data: { blocks: [{ id: 'a', type: 'asking', data: {} }] } });
    await blok.isReady;
    await rendered();

    const [button] = actions();

    expect(button?.parentElement?.hasAttribute(DATA_ATTR.pageIconRow)).toBe(true);
    expect(button?.getAttribute(DATA_ATTR.pageHeaderAction)).toBe('asking');
    expect(button?.textContent).toBe('Add description');

    button?.click();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(actions()[0]?.textContent).toBe('Hide description');
  });

  // notion-motion.md Round 98 §1 #5: a button rebuilt on pointer enter shows at once instead of fading in.
  it('keeps the same button across pointer enters and label changes', async () => {
    blok = create({ holder, pageTitle: true, data: { blocks: [{ id: 'a', type: 'asking', data: {} }] } });
    await blok.isReady;
    await rendered();
    const [first] = actions();
    const row = first?.parentElement;
    // Moving a node, even to where it already is, restarts it with no transition.
    const moves = new MutationObserver(() => undefined);

    if (row == null) {
      throw new Error('no row');
    }
    moves.observe(row, { childList: true });
    header().dispatchEvent(new PointerEvent('pointerenter'));
    header().dispatchEvent(new PointerEvent('pointerenter'));
    expect(moves.takeRecords()).toEqual([]);
    moves.disconnect();
    expect(actions()).toEqual([first]);

    first?.click();
    expect(actions()).toEqual([first]);
    expect(first?.textContent).toBe('Hide description');
  });

  // notion-motion.md Round 86 (row 27/73): a full-page database's page title is 32px with the tabs 12 under it.
  it('marks the header while the first block is a full-page database, and clears it when a block goes above', async () => {
    blok = create({ holder, pageTitle: true, data: { blocks: [{ id: 'd', type: 'fullDb', data: {} }] } });
    await blok.isReady;
    await rendered();

    expect(header().hasAttribute(DATA_ATTR.pageFullDatabase)).toBe(true);

    await blok.blocks.insert('paragraph', { text: 'above' }, {}, 0);

    expect(header().hasAttribute(DATA_ATTR.pageFullDatabase)).toBe(false);
  });

  it('does not mark the header when the first block is anything else', async () => {
    blok = create({ holder, pageTitle: true, data: { blocks: [{ id: 'a', type: 'asking', data: {} }, { id: 'd', type: 'fullDb', data: {} }] } });
    await blok.isReady;
    await rendered();

    expect(header().hasAttribute(DATA_ATTR.pageFullDatabase)).toBe(false);
  });

  it('drops the buttons when the editor turns read-only', async () => {
    blok = create({ holder, pageTitle: true, data: { blocks: [{ id: 'a', type: 'asking', data: {} }] } });
    await blok.isReady;
    header().dispatchEvent(new PointerEvent('pointerenter'));
    expect(actions()).toHaveLength(1);

    await blok.readOnly.set(true);

    expect(actions()).toEqual([]);
  });

  it('asks nothing of a block that is not first, and adds nothing to the row', async () => {
    blok = create({ holder, pageTitle: true, data: { blocks: [
      { id: 'p', type: 'paragraph', data: { text: 'first' } },
      { id: 'a', type: 'asking', data: {} },
    ] } });
    await blok.isReady;
    const before = holder.querySelector(`[${DATA_ATTR.pageIconRow}]`)?.innerHTML;

    header().dispatchEvent(new PointerEvent('pointerenter'));

    expect(actions()).toEqual([]);
    expect(holder.querySelector(`[${DATA_ATTR.pageIconRow}]`)?.innerHTML).toBe(before);
  });
});
