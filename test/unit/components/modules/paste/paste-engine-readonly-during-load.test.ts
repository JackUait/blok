/**
 * Read-only can turn on while the first paste waits for the paste pipeline.
 * The paste must not land in a read-only editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Engine from '../../../../../src/components/modules/paste/engine';

const engineGate = vi.hoisted(() => {
  const gate: { open: () => void; opened: Promise<void> } = { open: () => undefined, opened: Promise.resolve() };

  gate.opened = new Promise<void>((resolve) => {
    gate.open = resolve;
  });

  return gate;
});

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
  readOnly: API['readOnly'];
}

describe('read-only while the paste pipeline loads', () => {
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

  it('drops the pending paste', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'A' } }] },
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
      clipboardData: { getData: (type: string): string => (type === 'text/plain' ? 'P1\nP2' : ''), types: ['text/plain'] },
    }));

    await instance.readOnly.toggle(true);
    engineGate.open();
    await vi.dynamicImportSettled();
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });

    // A read-only editor cannot save.
    await instance.readOnly.toggle(false);
    const texts = (await instance.save()).blocks.map(block => htmlOf(block.data.text));

    expect(texts).toEqual(['A']);
  });
});
