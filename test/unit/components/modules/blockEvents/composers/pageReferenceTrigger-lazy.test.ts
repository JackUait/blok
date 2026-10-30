import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../../../../../src/components/block';
import type * as PagePickerKit from '../../../../../../src/components/modules/blockEvents/composers/page-picker-kit';
import type { PageConfig, PageSearchResult } from '../../../../../../src/tools/page/types';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

type Kit = typeof PagePickerKit;

const loader = vi.hoisted(() => ({
  load: vi.fn<() => Promise<Kit>>(),
}));

vi.mock('../../../../../../src/components/modules/blockEvents/composers/load-page-picker-kit', () => ({
  loadPagePickerKit: loader.load,
}));

const { PageReferenceTrigger } = await import('../../../../../../src/components/modules/blockEvents/composers/pageReferenceTrigger');
const kit = await vi.importActual<Kit>('../../../../../../src/components/modules/blockEvents/composers/page-picker-kit');

const inputEvent = (target: EventTarget): InputEvent => {
  const event = new InputEvent('input', { inputType: 'insertText', data: 'd' });

  Object.defineProperty(event, 'target', { value: target });

  return event;
};

const deferred = (): { promise: Promise<Kit>; resolve: (v: Kit) => void } => {
  const out: { resolve: (v: Kit) => void } = { resolve: () => undefined };
  const promise = new Promise<Kit>((resolve) => {
    out.resolve = resolve;
  });

  return { promise, ...out };
};

const setup = (text: string): {
  block: Block;
  search: ReturnType<typeof vi.fn<(query: string) => Promise<readonly PageSearchResult[]>>>;
  trigger: InstanceType<typeof PageReferenceTrigger>;
  type: (next: string) => Promise<boolean>;
} => {
  const block = createBlock(text);
  const search = vi.fn<(query: string) => Promise<readonly PageSearchResult[]>>().mockResolvedValue([]);
  const page: PageConfig = { search };
  const modules = {
    ...createBlokModules(block),
    Tools: { blockTools: new Map([['page', { settings: page }]]) },
    ReadOnly: { isEnabled: false },
  } as unknown as BlokModules;
  const trigger = new PageReferenceTrigger(modules);
  const input = block.currentInput as HTMLElement;

  document.body.append(block.holder);
  setCaret(block, text.length);

  /** Puts `next` in the block, caret at its end, and fires the input event. */
  const type = (next: string): Promise<boolean> => {
    input.textContent = next;
    setCaret(block, next.length);

    return trigger.handleInput(inputEvent(input));
  };

  return { block, search, trigger, type };
};

describe('PageReferenceTrigger loads the page picker on the first "@"', () => {
  const triggers: Array<InstanceType<typeof PageReferenceTrigger>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    triggers.splice(0).forEach((trigger) => trigger.destroy());
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it('opens on what the user typed while the code loaded', async () => {
    const pending = deferred();

    loader.load.mockReturnValue(pending.promise);
    const { search, trigger, type } = setup('See ');

    triggers.push(trigger);
    const first = type('See @r');
    const second = type('See @ro');

    expect(trigger.opened).toBe(false);
    pending.resolve(kit);
    await Promise.all([first, second]);

    expect(trigger.opened).toBe(true);
    expect(search.mock.calls).toEqual([['ro']]);
  });

  it('opens nothing when the "@" is deleted while the code loads', async () => {
    const pending = deferred();

    loader.load.mockReturnValue(pending.promise);
    const { search, trigger, type } = setup('See ');

    triggers.push(trigger);
    const first = type('See @');
    const second = type('See ');

    pending.resolve(kit);
    await Promise.all([first, second]);

    expect(trigger.opened).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it('reports a failed load and opens on the next "@"', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('chunk failed');

    loader.load.mockRejectedValueOnce(failure).mockResolvedValue(kit);
    const { trigger, type } = setup('See ');

    triggers.push(trigger);
    await type('See @r');

    expect(trigger.opened).toBe(false);
    expect(error.mock.calls.some((call) => String(call[0]).includes('page picker') && call.includes(failure))).toBe(true);

    await type('See @ro');

    expect(trigger.opened).toBe(true);
  });
});
