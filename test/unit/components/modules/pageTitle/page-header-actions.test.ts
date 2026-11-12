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

const create = (config: Partial<BlokConfig>): PublicBlok =>
  new Blok({ tools: { paragraph: { class: Paragraph }, asking: { class: Asking as never } }, ...config }) as unknown as PublicBlok;

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

  it('asks the first block when the pointer enters the header, and runs the button', async () => {
    blok = create({ holder, pageTitle: true, data: { blocks: [{ id: 'a', type: 'asking', data: {} }] } });
    await blok.isReady;

    expect(actions()).toEqual([]);
    header().dispatchEvent(new PointerEvent('pointerenter'));
    const [button] = actions();

    expect(button?.parentElement?.hasAttribute(DATA_ATTR.pageIconRow)).toBe(true);
    expect(button?.getAttribute(DATA_ATTR.pageHeaderAction)).toBe('asking');
    expect(button?.textContent).toBe('Add description');

    button?.click();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(actions()[0]?.textContent).toBe('Hide description');
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
