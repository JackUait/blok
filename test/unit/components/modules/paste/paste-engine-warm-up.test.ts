/**
 * After boot the editor loads its paste pipeline when the page is idle, so a
 * first paste rarely waits. A failed warm-up stays silent; the next paste
 * loads it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Engine from '../../../../../src/components/modules/paste/engine';
import type * as Logger from '../../../../../src/components/utils/logger';

const engines = vi.hoisted(() => ({ built: 0, failures: 0 }));

vi.mock('../../../../../src/components/modules/paste/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof Engine>();

  class CountedEngine extends actual.PasteEngine {
    constructor(...args: ConstructorParameters<typeof actual.PasteEngine>) {
      if (engines.failures > 0) {
        engines.failures -= 1;
        throw new Error('chunk failed');
      }
      super(...args);
      engines.built += 1;
    }
  }

  return { ...actual, PasteEngine: CountedEngine };
});

vi.mock('../../../../../src/components/utils/logger', async (importOriginal) => ({
  ...await importOriginal<typeof Logger>(),
  log: vi.fn(),
}));

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { log } from '../../../../../src/components/utils/logger';
import type { API, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
}

const idle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 50);
});

describe('paste pipeline warm-up', () => {
  let editor: TestEditor | undefined;
  let holder: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    engines.built = 0;
    engines.failures = 0;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  const boot = async (readOnly = false): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      readOnly,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'A' } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;

    return instance;
  };

  it('loads the pipeline once the editor is idle, before any paste', async () => {
    await boot();

    await vi.waitFor(() => {
      expect(engines.built).toBe(1);
    });
  });

  it('does not load it in a read-only editor', async () => {
    await boot(true);
    await idle();
    await vi.dynamicImportSettled();

    expect(engines.built).toBe(0);
  });

  it('stays silent when the warm-up fails, and the next paste loads it', async () => {
    engines.failures = 1;
    const instance = await boot();

    await idle();
    await vi.dynamicImportSettled();
    expect(engines.failures).toBe(0);
    expect(engines.built).toBe(0);
    expect(log).not.toHaveBeenCalled();

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

    await vi.waitFor(async () => {
      expect((await instance.save()).blocks.map(block => htmlOf(block.data.text))).toEqual(['AP1']);
    });
    expect(engines.built).toBe(1);
  });
});
