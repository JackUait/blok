/**
 * An editor destroyed while its paste pipeline loads must not paste into
 * the torn-down editor once the load lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Engine from '../../../../../src/components/modules/paste/engine';
import type * as LazyStyles from '../../../../../src/components/utils/lazy-styles';

const engineLoad = vi.hoisted(() => {
  const state: { open: () => void; opened: Promise<void>; processed: number } = { open: () => undefined, opened: Promise.resolve(), processed: 0 };

  state.opened = new Promise<void>((resolve) => {
    state.open = resolve;
  });

  return state;
});

// No idle warm-up: these tests need the first paste to wait for the load.
vi.mock('../../../../../src/components/utils/lazy-styles', async (importOriginal) => ({
  ...await importOriginal<typeof LazyStyles>(),
  whenIdle: (): void => undefined,
}));

vi.mock('../../../../../src/components/modules/paste/engine', async (importOriginal) => {
  await engineLoad.opened;
  const actual = await importOriginal<typeof Engine>();

  class CountingEngine extends actual.PasteEngine {
    public override async processDataTransfer(...args: Parameters<Engine.PasteEngine['processDataTransfer']>): Promise<void> {
      engineLoad.processed += 1;

      return super.processDataTransfer(...args);
    }
  }

  return { ...actual, PasteEngine: CountingEngine };
});

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  caret: API['caret'];
}

describe('destroy while the paste pipeline loads', () => {
  let holder: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('drops the pending paste', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 't', type: 'paragraph', data: { text: 'X' } }] },
    }) as unknown as TestEditor;

    await instance.isReady;

    const target = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="t"] *') ?? []).find(element => element.contentEditable === 'true');

    if (target === undefined) {
      throw new Error('no paste target');
    }
    target.setAttribute('contenteditable', 'true');
    target.focus();
    instance.caret.setToBlock('t', 'end');
    target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string): string => (type === 'text/plain' ? 'Y' : ''), types: ['text/plain'] },
    }));
    // The paste is now waiting on the load.
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });

    instance.destroy();
    engineLoad.open();

    // The engine module is loaded once the mock factory has run; give the shell a few turns after that.
    await vi.dynamicImportSettled();
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });

    expect(engineLoad.processed).toBe(0);
  });
});
