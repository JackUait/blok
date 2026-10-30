/**
 * A block can be rewritten (its DOM replaced) while the first paste waits for
 * the paste pipeline. The paste still belongs to that block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Engine from '../../../../../src/components/modules/paste/engine';
import type * as LazyStyles from '../../../../../src/components/utils/lazy-styles';

const engineGate = vi.hoisted(() => {
  const gate: { open: () => void; opened: Promise<void> } = { open: () => undefined, opened: Promise.resolve() };

  gate.opened = new Promise<void>((resolve) => {
    gate.open = resolve;
  });

  return gate;
});

// No idle warm-up: these tests need the first paste to wait for the load.
vi.mock('../../../../../src/components/utils/lazy-styles', async (importOriginal) => ({
  ...await importOriginal<typeof LazyStyles>(),
  whenIdle: (): void => undefined,
}));

vi.mock('../../../../../src/components/modules/paste/engine', async (importOriginal) => {
  await engineGate.opened;

  return importOriginal<typeof Engine>();
});

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
  blocks: API['blocks'];
}

describe('block rewritten while the paste pipeline loads', () => {
  let editor: TestEditor | undefined;
  let holder: HTMLDivElement | undefined;

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

  it('lands the paste in the rewritten block, at the same offset', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'A' } }, { id: 'b', type: 'paragraph', data: { text: 'B' } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;

    const target = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="a"] *') ?? []).find(element => element.contentEditable === 'true');

    if (target === undefined) {
      throw new Error('no paste target');
    }
    target.setAttribute('contenteditable', 'true');
    target.focus();
    instance.caret.setToBlock('a', 'end');
    target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string): string => (type === 'text/plain' ? 'P1' : ''), types: ['text/plain'] },
    }));

    await instance.blocks.update('a', { text: 'AZ' });
    // jsdom does not reflect contentEditable to the attribute; a browser does.
    Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="a"] *') ?? []).find(element => element.contentEditable === 'true')?.setAttribute('contenteditable', 'true');
    engineGate.open();

    await vi.waitFor(async () => {
      expect((await instance.save()).blocks.map(block => htmlOf(block.data.text))).toEqual(['AP1Z', 'B']);
    });
  });
});
