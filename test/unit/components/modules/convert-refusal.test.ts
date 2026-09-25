/**
 * A "turn into" that the document REFUSES must not escape as an unhandled
 * rejection, must not strand the state its entry point opened, and must tell
 * the user nothing happened.
 *
 * `BlockMutation.convert()` rejects when a peer is editing the same block —
 * writing the stale snapshot back would delete the peer's characters, so it
 * fails closed. Every UI entry point that starts a conversion has to cope.
 *
 * The refusal is FORCED here, not raced for. Whether a given peer burst wins
 * the race is a property of the reconciler and changes whenever it is tuned;
 * what these tests pin is what the UI does once a conversion is refused. That
 * `convert()` really refuses under concurrency is pinned separately, by
 * `blockManager/concurrent-blocks-api-loss.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { BlockManager } from '../../../../src/components/modules/blockManager/blockManager';
import { YjsManager } from '../../../../src/components/modules/yjs';
import { handleBackspace as handleListBackspace, handleEnter as handleListEnter } from '../../../../src/tools/list/list-keyboard';
import { handleToggleBackspace } from '../../../../src/tools/toggle/toggle-keyboard';
import { handleHeaderToggleBackspace } from '../../../../src/tools/header/header-toggle-keyboard';
import en from '../../../../src/components/i18n/locales/en.json';
import type { API } from '../../../../types';
import type { OutputData } from '../../../../types';

const messages: Record<string, string> = en;

/** Collect every unhandled rejection raised while `run` is in flight. */
const withUnhandledRejections = async (run: () => Promise<void>): Promise<unknown[]> => {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    seen.push(reason);
  };

  process.on('unhandledRejection', onUnhandled);

  try {
    await run();
    // Node reports an unhandled rejection at the end of the tick it was
    // rejected in, so a macrotask has to pass before `seen` is complete.
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }

  return seen;
};

describe('a refused "turn into" at the keyboard shortcut', () => {
  let editor: { isReady: Promise<unknown>; destroy: () => void; caret: { setToBlock: (index: number, position?: string) => void } } | undefined;
  let holder: HTMLDivElement | undefined;
  let local: YjsManager | undefined;
  let notifications: Array<{ message?: unknown }>;
  let convert: MockedFunction<BlockManager['convert']>;

  const flush = async (): Promise<void> => {
    for (let index = 0; index < 20; index++) {
      await Promise.resolve();
    }
  };

  const frame = async (): Promise<void> => {
    await flush();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await flush();
  };

  const requireLocal = (): YjsManager => {
    if (local === undefined) {
      throw new Error('the editor never built a YjsManager');
    }

    return local;
  };

  const boot = async (): Promise<void> => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph,
        header: Header },
      notifier: (options) => {
        notifications.push(options);
      },
      data: { blocks: [{ id: 'one', type: 'paragraph', data: { text: 'alpha' } }] } as OutputData,
    }) as unknown as typeof editor;

    editor = instance;
    await instance!.isReady;
    await flush();

    instance!.caret.setToBlock(0, 'end');
    await flush();
  };

  const pressTurnInto = (code: string, modifiers: Partial<KeyboardEventInit> = { metaKey: true,
    altKey: true }): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code,
      key: code.slice(-1),
      bubbles: true,
      ...modifiers }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = [];
    holder = document.createElement('div');
    document.body.appendChild(holder);

    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (
      this: YjsManager,
      blocks: Parameters<YjsManager['fromJSON']>[0]
    ) {
      local = this;

      return originalFromJSON.call(this, blocks);
    });

    // The document refuses the conversion. Forced, so the assertions below are
    // about the UI's response and not about who wins a reconcile race.
    convert = vi.fn<BlockManager['convert']>(async () => {
      throw new Error('Could not convert Block «one»: it is being edited by someone else. Nothing was changed.');
    });
    vi.spyOn(BlockManager.prototype, 'convert').mockImplementation(convert);
  });

  afterEach(async () => {
    editor?.destroy();
    await frame();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    local = undefined;
    vi.restoreAllMocks();
  });

  it('raises no unhandled rejection when the heading shortcut is refused', async () => {
    await boot();

    const unhandled = await withUnhandledRejections(async () => {
      pressTurnInto('Digit2');
      await frame();
    });

    expect(unhandled).toEqual([]);
    // Without this the test would pass just as happily if the shortcut never
    // reached the conversion at all.
    expect(convert).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }), 'header', { level: 2 });
  });

  it('closes the undo group the heading shortcut opened, even when refused', async () => {
    await boot();

    const manager = requireLocal();
    // Spy on the prototype and filter by receiver: an instance spy silently
    // missed a call here, and a wrong count would "prove" the wrong thing.
    const stopCapturing = vi.spyOn(YjsManager.prototype, 'stopCapturing');

    pressTurnInto('Digit2');
    await frame();

    const ownCalls = stopCapturing.mock.contexts.filter((context) => context === manager).length;

    // The open call is paired with a close call. Leaving the group open folds
    // the user's NEXT edit into the undo entry of a conversion that never was.
    expect(ownCalls % 2).toBe(0);
    expect(ownCalls).toBeGreaterThan(0);
    expect(convert).toHaveBeenCalled();
  });

  it('tells the user the block was not changed', async () => {
    await boot();

    pressTurnInto('Digit2');
    await frame();

    expect(notifications.map((entry) => entry.message)).toContain(messages['blockSettings.convertFailed']);
    expect(convert).toHaveBeenCalled();
  });

  it('raises no unhandled rejection when the list shortcut is refused', async () => {
    await boot();

    const unhandled = await withUnhandledRejections(async () => {
      pressTurnInto('Digit5', { metaKey: true,
        shiftKey: true });
      await frame();
    });

    expect(unhandled).toEqual([]);
    expect(notifications.map((entry) => entry.message)).toContain(messages['blockSettings.convertFailed']);
    expect(convert).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }), 'list', { style: 'unordered' });
  });
});

describe('a refused "turn into" inside a block tool\'s keyboard handler', () => {
  let notifier: ReturnType<typeof vi.fn>;

  const buildApi = (extra: Record<string, unknown> = {}): API => ({
    blocks: {
      convert: vi.fn(async () => {
        throw new Error('Could not convert Block «x»: it is being edited by someone else. Nothing was changed.');
      }),
      getById: vi.fn(() => null),
      getChildren: vi.fn(() => []),
      getBlockIndex: vi.fn(() => 0),
      delete: vi.fn(async () => undefined),
      setBlockParent: vi.fn(),
      ...extra,
    },
    caret: { setToBlock: vi.fn() },
    notifier: { show: notifier },
    i18n: { t: (key: string) => messages[key] ?? key },
  } as unknown as API);

  const caretAtStart = (element: HTMLElement): void => {
    const range = document.createRange();

    range.setStart(element, 0);
    range.collapse(true);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    notifier = vi.fn();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const expectReported = (): void => {
    expect(notifier).toHaveBeenCalledWith(
      expect.objectContaining({ message: messages['blockSettings.convertFailed'] })
    );
  };

  it('does not reject out of the list Backspace handler', async () => {
    const api = buildApi();
    const element = document.createElement('div');
    const content = document.createElement('div');

    content.contentEditable = 'true';
    element.append(content);
    document.body.append(element);
    caretAtStart(content);

    await expect(handleListBackspace({
      api,
      blockId: 'item',
      data: { text: '' } as never,
      element,
      getContentElement: () => content,
      syncContentFromDOM: () => undefined,
      getDepth: () => 0,
    }, new KeyboardEvent('keydown', { key: 'Backspace' }))).resolves.toBeUndefined();

    expectReported();
  });

  it('does not reject out of the list Enter handler', async () => {
    const api = buildApi();
    const element = document.createElement('div');
    const content = document.createElement('div');

    content.contentEditable = 'true';
    element.append(content);
    document.body.append(element);
    caretAtStart(content);

    await expect(handleListEnter({
      api,
      blockId: 'item',
      data: { text: '' } as never,
      element,
      getContentElement: () => content,
      syncContentFromDOM: () => undefined,
      getDepth: () => 0,
    })).resolves.toBeUndefined();

    expectReported();
  });

  it('does not reject out of the toggle Backspace handler', async () => {
    const api = buildApi();
    const content = document.createElement('div');

    content.contentEditable = 'true';
    document.body.append(content);
    caretAtStart(content);

    await expect(handleToggleBackspace({
      api,
      blockId: 'toggle',
      data: { text: '' } as never,
      getContentElement: () => content,
      syncContentFromDOM: () => undefined,
    } as never, new KeyboardEvent('keydown', { key: 'Backspace' }))).resolves.toBeUndefined();

    expectReported();
  });

  it('does not reject out of the toggle-heading Backspace handler', async () => {
    const api = buildApi();
    const content = document.createElement('div');

    content.contentEditable = 'true';
    document.body.append(content);
    caretAtStart(content);

    await expect(handleHeaderToggleBackspace({
      api,
      blockId: 'heading',
      currentLevel: 2,
      getText: () => '',
      getContentElement: () => content,
      syncContentFromDOM: () => undefined,
    } as never, new KeyboardEvent('keydown', { key: 'Backspace' }))).resolves.toBeUndefined();

    expectReported();
  });
});
