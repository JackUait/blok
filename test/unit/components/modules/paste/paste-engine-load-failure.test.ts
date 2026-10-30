/**
 * The paste pipeline is a separate chunk. When it fails to load, the paste
 * must not be lost: its plain text goes in, a warning is logged, and the next
 * paste tries the load again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Engine from '../../../../../src/components/modules/paste/engine';
import type * as LazyStyles from '../../../../../src/components/utils/lazy-styles';
import type * as Logger from '../../../../../src/components/utils/logger';

const engineLoad = vi.hoisted(() => ({ failures: 0 }));

// No idle warm-up: these tests need the first paste to wait for the load.
vi.mock('../../../../../src/components/utils/lazy-styles', async (importOriginal) => ({
  ...await importOriginal<typeof LazyStyles>(),
  whenIdle: (): void => undefined,
}));

vi.mock('../../../../../src/components/modules/paste/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof Engine>();

  class FlakyEngine extends actual.PasteEngine {
    constructor(...args: ConstructorParameters<typeof actual.PasteEngine>) {
      if (engineLoad.failures > 0) {
        engineLoad.failures -= 1;
        throw new Error('chunk failed');
      }
      super(...args);
    }
  }

  return { ...actual, PasteEngine: FlakyEngine };
});

vi.mock('../../../../../src/components/utils/logger', async (importOriginal) => ({
  ...await importOriginal<typeof Logger>(),
  log: vi.fn(),
}));

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { BoldInlineTool } from '../../../../../src/components/inline-tools/inline-tool-bold';
import { log } from '../../../../../src/components/utils/logger';
import type { API, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
  blocks: API['blocks'];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, bold: BoldInlineTool },
    data: { blocks: [{ id: 't', type: 'paragraph', data: { text: 'X' } }] },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const paste = (instance: TestEditor, data: Record<string, string>): void => {
  const target = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="t"] *') ?? []).find(element => element.contentEditable === 'true');

  if (target === undefined) {
    throw new Error('no paste target');
  }
  target.setAttribute('contenteditable', 'true');
  target.focus();
  instance.caret.setToBlock('t', 'end');
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  }));
};

const savedText = async (instance: TestEditor): Promise<unknown> =>
  htmlOf((await instance.save()).blocks.find(block => block.id === 't')?.data.text);

describe('paste engine that fails to load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engineLoad.failures = 0;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('pastes the plain text as text, warns, and loads the pipeline on the next paste', async () => {
    const instance = await boot();

    engineLoad.failures = 1;
    paste(instance, { 'text/html': '<b>ignored</b>', 'text/plain': 'a <b>c</b>' });

    await vi.waitFor(async () => {
      expect(await savedText(instance)).toBe('Xa &lt;b&gt;c&lt;/b&gt;');
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('paste'), 'warn', expect.any(Error));

    paste(instance, { 'text/html': '<b>bold</b>', 'text/plain': 'bold' });

    await vi.waitFor(async () => {
      expect(await savedText(instance)).toBe('Xa &lt;b&gt;c&lt;/b&gt;<strong>bold</strong>');
    });
  });

  it('rejects renderFromHTML when the pipeline cannot load, and works once it can', async () => {
    const instance = await boot();

    engineLoad.failures = 1;

    await expect(instance.blocks.renderFromHTML('<p>first</p>')).rejects.toThrow('chunk failed');
    expect(await savedText(instance)).toBe('X');

    await instance.blocks.renderFromHTML('<p>second</p>');

    const saved = await instance.save();

    expect(saved.blocks.map(block => htmlOf(block.data.text))).toContain('second');
  });
});
