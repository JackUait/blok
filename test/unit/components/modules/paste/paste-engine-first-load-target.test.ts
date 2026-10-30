/**
 * The person can move the caret, or click outside the editor, while the
 * first paste waits for the paste pipeline. The paste still belongs where it
 * was made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Engine from '../../../../../src/components/modules/paste/engine';
import type * as Logger from '../../../../../src/components/utils/logger';

/** Runs while the pipeline loads; `fail` makes the load fail. */
const duringLoad = vi.hoisted(() => ({ run: (): void => undefined, fail: false }));

vi.mock('../../../../../src/components/modules/paste/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof Engine>();

  class HookedEngine extends actual.PasteEngine {
    constructor(...args: ConstructorParameters<typeof actual.PasteEngine>) {
      duringLoad.run();
      if (duringLoad.fail) {
        throw new Error('chunk failed');
      }
      super(...args);
    }
  }

  return { ...actual, PasteEngine: HookedEngine };
});

vi.mock('../../../../../src/components/utils/logger', async (importOriginal) => ({
  ...await importOriginal<typeof Logger>(),
  log: vi.fn(),
}));

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, BlokConfig, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let outside: HTMLDivElement | undefined;

const boot = async (config: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'A' } }, { id: 'b', type: 'paragraph', data: { text: 'B' } }] },
    ...config,
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const editable = (id: string): HTMLElement => {
  const element = Array.from(holder?.querySelectorAll<HTMLElement>(`[data-blok-id="${id}"] *`) ?? []).find(each => each.contentEditable === 'true');

  if (element === undefined) {
    throw new Error(`no editable ${id}`);
  }
  element.setAttribute('contenteditable', 'true');

  return element;
};

const pasteInto = (instance: TestEditor, id: string, data: Record<string, string>): void => {
  const target = editable(id);

  target.focus();
  instance.caret.setToBlock(id, 'end');
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  }));
};

const texts = async (instance: TestEditor): Promise<unknown[]> =>
  (await instance.save()).blocks.map(block => htmlOf(block.data.text));

const settle = async (): Promise<void> => {
  await vi.dynamicImportSettled();
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

/** A text field of the host page, outside the editor. */
const clickOutside = (): void => {
  const selection = window.getSelection();

  outside?.focus();
  selection?.collapse(outside?.firstChild ?? null, 0);
};

describe('first paste while the pipeline loads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    duringLoad.run = () => undefined;
    duringLoad.fail = false;
    holder = document.createElement('div');
    outside = document.createElement('div');
    outside.setAttribute('contenteditable', 'true');
    outside.textContent = 'host';
    document.body.append(holder, outside);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    outside?.remove();
    vi.restoreAllMocks();
  });

  it('lands in the block it was pasted into after the caret moved to another block', async () => {
    const instance = await boot();

    duringLoad.run = () => {
      instance.caret.setToBlock('b', 'end');
    };
    pasteInto(instance, 'a', { 'text/plain': 'P1' });

    await vi.waitFor(async () => {
      expect(await texts(instance)).toEqual(['AP1', 'B']);
    });
  });

  it('pastes the plain text into the block it was pasted into when the load fails after a click outside', async () => {
    const instance = await boot();

    duringLoad.fail = true;
    duringLoad.run = clickOutside;
    pasteInto(instance, 'a', { 'text/plain': 'P1' });

    await vi.waitFor(async () => {
      expect(await texts(instance)).toEqual(['AP1', 'B']);
    });
    expect(outside?.innerHTML).toBe('host');
  });

  it('runs onBeforePaste on a failed load, and still pastes the plain text', async () => {
    const onBeforePaste = vi.fn((): string | null => null);
    const instance = await boot({ onBeforePaste });

    duringLoad.fail = true;
    pasteInto(instance, 'a', { 'text/plain': 'P1', 'text/html': '<b>P1</b>' });

    await vi.waitFor(async () => {
      expect(await texts(instance)).toEqual(['AP1', 'B']);
    });
    expect(onBeforePaste).toHaveBeenCalledWith('<b>P1</b>');
  });

  it('pastes nothing when the block it was pasted into is gone', async () => {
    const instance = await boot();

    duringLoad.fail = true;
    duringLoad.run = () => {
      holder?.querySelector('[data-blok-id="a"]')?.remove();
      clickOutside();
    };
    pasteInto(instance, 'a', { 'text/plain': 'P1' });
    await settle();

    expect(outside?.innerHTML).toBe('host');
  });
});
