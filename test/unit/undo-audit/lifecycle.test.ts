import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../src/blok';
import { Paragraph } from '../../../src/tools/paragraph';
import type { OutputData } from '../../../types';

/**
 * The runtime class and the published type don't unify (module APIs are
 * grafted on after isReady), so type only what these tests use.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  render: (data: OutputData) => Promise<void>;
  save: () => Promise<OutputData>;
  history: { canUndo: () => boolean; undo: () => void };
}

const isTestEditor = (value: unknown): value is TestEditor =>
  typeof value === 'object' && value !== null && 'history' in value && 'render' in value;

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = async (blocks: OutputData['blocks']): Promise<TestEditor> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);

  const instance: unknown = new Blok({
    holder,
    tools: { paragraph: { class: Paragraph } },
    data: { blocks },
  });

  const ready: unknown = await (instance as { isReady: Promise<unknown> }).isReady;

  if (!isTestEditor(ready)) {
    throw new Error('editor did not expose history/render');
  }

  editor = ready;

  return ready;
};

describe('undo audit: lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  // LIF-2. Expected: render() replaces the document and clears history, as it does for a non-empty document.
  it('LIF-2: render of an empty document leaves an undo entry that brings the old document back', async () => {
    const blok = await createEditor([{ id: 'old', type: 'paragraph', data: { text: 'Old doc' } }]);

    await blok.render({ blocks: [] });

    expect(blok.history.canUndo()).toBe(false);

    blok.history.undo();
    const saved = await blok.save();

    expect(saved.blocks.map((block) => block.id)).not.toContain('old');
  });
});
