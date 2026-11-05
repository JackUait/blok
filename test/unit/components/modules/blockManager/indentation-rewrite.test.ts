// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Core } from '../../../../../src/components/core';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { Paragraph, Table, Toggle } from '../../../../../src/tools';

class BootedEditor extends Blok {
  public moduleGraph: BlokModules | undefined;

  public override exportAPI(core: Core): void {
    this.moduleGraph = core.moduleInstances;
    super.exportAPI(core);
  }
}

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  moduleGraph: BlokModules | undefined;
}

const editors: TestEditor[] = [];

const boot = async (): Promise<BlokModules> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new BootedEditor({
    holder,
    data: {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['c'] }]] }, content: ['c'] },
        { id: 'c', type: 'paragraph', data: { text: 'cell' }, parent: 't' },
        { id: 'g', type: 'toggle', data: { text: 'toggle', isOpen: true }, content: ['k'] },
        { id: 'k', type: 'paragraph', data: { text: 'child' }, parent: 'g' },
        { id: 'p', type: 'paragraph', data: { text: 'top' } },
      ],
    },
    tools: { paragraph: { class: Paragraph }, table: { class: Table }, toggle: { class: Toggle } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  if (editor.moduleGraph === undefined) {
    throw new Error('no module graph');
  }

  return editor.moduleGraph;
};

describe('block indentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each(['c', 'k', 'p'])('writes nothing when block %s already has its indentation', async (id) => {
    const modules = await boot();
    const block = modules.BlockManager.getBlockById(id);

    if (block === undefined) {
      throw new Error(`no block ${id}`);
    }

    modules.BlockManager.updateBlockIndentation(block);
    const before = { style: block.holder.getAttribute('style'), depth: block.holder.getAttribute('data-blok-depth') };
    const observer = new MutationObserver(() => undefined);

    observer.observe(block.holder, { attributes: true });
    modules.BlockManager.updateBlockIndentation(block);
    const records = observer.takeRecords();

    observer.disconnect();

    expect(records.map((record) => record.attributeName)).toEqual([]);
    expect({ style: block.holder.getAttribute('style'), depth: block.holder.getAttribute('data-blok-depth') }).toEqual(before);
  });
});
