/**
 * The browser empties a clipboard or drop DataTransfer once its event is
 * over. The paste pipeline loads on the first paste, after that, so the
 * Paste module must copy the data while the event is still running.
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
}

const dropped: File[] = [];

/** Takes image files, so a drop has somewhere to go. */
class FileSink {
  public static get pasteConfig(): { files: { mimeTypes: string[] } } {
    return { files: { mimeTypes: ['image/*'] } };
  }

  public onPaste(event: CustomEvent<{ file: File }>): void {
    dropped.push(event.detail.file);
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

/** A DataTransfer that reads empty once `dead` is set, like a browser's after its event. */
const transfer = (data: Record<string, string>, files: File[] = []): { dt: DataTransfer; kill: () => void } => {
  const state = { dead: false };
  const types = [...Object.keys(data), ...(files.length > 0 ? ['Files'] : [])];
  const dt = {
    get types(): string[] {
      return state.dead ? [] : types;
    },
    get files(): File[] {
      return state.dead ? [] : files;
    },
    get items(): Array<{ kind: string; type: string; getAsFile: () => File | null }> {
      return state.dead ? [] : files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }));
    },
    getData: (type: string): string => (state.dead ? '' : data[type] ?? ''),
    setData: (): void => undefined,
  };

  return { dt: dt as unknown as DataTransfer, kill: () => { state.dead = true; } };
};

/** Lets the event's microtasks run, as a browser does before it ends the event. */
const endOfEvent = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

describe('first paste while the paste pipeline loads', () => {
  let editor: TestEditor | undefined;
  let holder: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    dropped.length = 0;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('lands the pasted text and the dropped file after their DataTransfers are emptied', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, sink: FileSink },
      data: { blocks: [{ id: 't', type: 'paragraph', data: { text: 'X' } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;

    const target = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="t"] *') ?? []).find(element => element.contentEditable === 'true');

    if (target === undefined) {
      throw new Error('no paste target');
    }
    target.setAttribute('contenteditable', 'true');
    target.focus();
    instance.caret.setToBlock('t', 'end');

    const pasted = transfer({ 'text/plain': 'Y' });
    const pasteEvent = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData: pasted.dt });

    target.dispatchEvent(pasteEvent);
    await endOfEvent();
    pasted.kill();

    const image = new File(['x'], 'photo.png', { type: 'image/png' });
    const drop = transfer({}, [image]);
    const dropEvent = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: drop.dt });

    target.dispatchEvent(dropEvent);
    await endOfEvent();
    drop.kill();

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(dropEvent.defaultPrevented).toBe(true);

    engineGate.open();

    await vi.waitFor(async () => {
      expect(htmlOf((await instance.save()).blocks.find(block => block.id === 't')?.data.text)).toBe('XY');
      expect(dropped).toEqual([image]);
    });
  });
});
