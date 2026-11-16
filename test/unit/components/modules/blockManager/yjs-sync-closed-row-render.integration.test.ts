import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { YjsManager } from '../../../../../src/components/modules/yjs';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../../src/tools/database-row';
import type { API, OutputData } from '../../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy(): void;
  save(): Promise<OutputData>;
  blocks: API['blocks'];
  history: { undo(): void; redo(): void };
  module: {
    blockManager: { blocks: Block[] };
    yjsManager: YjsManager;
  };
}

const seed = [
  {
    id: 'db', type: 'database', data: {
      title: 'Tasks',
      schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'view', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'view',
    },
  },
  { id: 'row', type: 'database-row', parent: 'db', data: { properties: { title: 'Task' }, position: 'a0' } },
  { id: 'body', type: 'paragraph', parent: 'row', data: { text: 'Initial body' } },
  { id: 'descendant', type: 'paragraph', parent: 'body', data: { text: 'Nested body' } },
];

const record = (id: string): (typeof seed)[number] => {
  const found = seed.find(candidate => candidate.id === id);
  if (found === undefined) throw new Error(`missing fixture ${id}`);

  return found;
};

const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await new Promise(resolve => setTimeout(resolve, 0));
};

describe('Yjs materialization keeps closed database row bodies dormant', () => {
  let editor: Runtime | undefined;
  let peer: DocumentStore | undefined;
  let holder: HTMLDivElement;

  const runtime = (): Runtime => {
    if (editor === undefined) throw new Error('editor not booted');

    return editor;
  };
  const source = (): DocumentStore => {
    if (peer === undefined) throw new Error('peer not booted');

    return peer;
  };
  const block = (id: string): Block => {
    const found = runtime().module.blockManager.blocks.find(candidate => candidate.id === id);
    if (found === undefined) throw new Error(`missing block ${id}`);

    return found;
  };
  const ship = async (): Promise<void> => {
    const manager = runtime().module.yjsManager;
    manager.applyRemoteUpdate(source().encodeStateAsUpdate(manager.getStateVector()));
    await settle();
  };
  const boot = async (): Promise<void> => {
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks: [] },
    }) as unknown as Runtime;
    await editor.isReady;
    await settle();
    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(editor.module.yjsManager.encodeStateAsUpdate());
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });
  afterEach(async () => {
    editor?.destroy();
    peer?.destroy();
    await settle();
    holder.remove();
    editor = undefined;
    peer = undefined;
    vi.restoreAllMocks();
  });

  it('registers a whole remote row subtree without rendering its body, then opens the current content without an echo', async () => {
    await boot();
    const render = vi.spyOn(Paragraph.prototype, 'render');
    source().transactWithoutCapture(() => {
      for (const record of seed) source().addBlock(record);
    });
    await ship();

    expect(render).not.toHaveBeenCalled();
    expect(block('body').holder.hasAttribute('data-blok-deferred-render')).toBe(true);
    expect(block('descendant').holder.hasAttribute('data-blok-deferred-render')).toBe(true);
    expect(block('row').holder.classList.contains('hidden')).toBe(true);
    const manager = runtime().module.yjsManager;
    const before = manager.toJSON();
    const writes = vi.fn();
    const unsubscribe = manager.onDocUpdate(writes);
    block('db').call('openRow', { rowId: 'row' });
    await settle();

    expect(block('body').holder.textContent).toContain('Initial body');
    expect(block('descendant').holder.textContent).toContain('Nested body');
    expect(block('body').holder.hasAttribute('data-blok-deferred-render')).toBe(false);
    expect(manager.toJSON()).toEqual(before);
    expect(writes).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps remote single adds, updates and deletes asleep, preserving only the latest body on opening', async () => {
    await boot();
    source().transactWithoutCapture(() => {
      source().addBlock(record('db'));
      source().addBlock(record('row'));
    });
    await ship();
    const render = vi.spyOn(Paragraph.prototype, 'render');
    source().addBlock(record('body'));
    await ship();
    source().addBlock(record('descendant'));
    await ship();
    source().updateBlockData('body', 'text', 'Newest remote body');
    source().removeBlock('descendant');
    await ship();

    expect(render).not.toHaveBeenCalled();
    expect(block('body').holder.hasAttribute('data-blok-deferred-render')).toBe(true);
    expect(runtime().module.blockManager.blocks.some(candidate => candidate.id === 'descendant')).toBe(false);
    block('db').call('openRow', { rowId: 'row' });
    await settle();

    expect(block('body').holder.textContent).toContain('Newest remote body');
    expect(block('body').holder.textContent).not.toContain('Initial body');
    const saved = await runtime().save();
    expect(saved.blocks.find(candidate => candidate.id === 'body')?.data).toMatchObject({ text: [{ text: 'Newest remote body' }] });
    expect(saved.blocks.some(candidate => candidate.id === 'descendant')).toBe(false);
  });

  it('replays deletion undo and redo under a closed row without waking the restored body', async () => {
    await boot();
    source().transactWithoutCapture(() => {
      source().addBlock(record('db'));
      source().addBlock(record('row'));
    });
    await ship();
    const render = vi.spyOn(Paragraph.prototype, 'render');
    // Redo must be allowed to delete these blocks: peer-authored body content
    // is deliberately protected by history's peer-content deletion guard.
    runtime().blocks.insertAt('paragraph', { text: 'Initial body' }, { parentId: 'row', position: 'end', id: 'body', select: false });
    runtime().blocks.insertAt('paragraph', { text: 'Nested body' }, { parentId: 'body', position: 'end', id: 'descendant', select: false });
    await settle();
    const manager = runtime().module.yjsManager;
    manager.stopCapturing();
    const index = runtime().module.blockManager.blocks.findIndex(candidate => candidate.id === 'body');
    await runtime().blocks.delete(index, false);
    await settle();
    manager.stopCapturing();
    // Count the replay itself, independently of the local insertion/deletion
    // APIs used to establish the history entry.
    render.mockClear();
    runtime().history.undo();
    await settle();

    expect(render).not.toHaveBeenCalled();
    expect(block('body').holder.hasAttribute('data-blok-deferred-render')).toBe(true);
    // Paragraph deletion promotes its children; this existing descendant is
    // reparented back on undo rather than deleted and rematerialized.
    expect(block('descendant').parentId).toBe('body');
    expect(block('descendant').holder.textContent).toContain('Nested body');
    runtime().history.redo();
    await settle();
    expect(runtime().module.blockManager.blocks.some(candidate => candidate.id === 'body')).toBe(false);
    runtime().history.undo();
    await settle();
    block('db').call('openRow', { rowId: 'row' });
    await settle();
    expect(block('body').holder.textContent).toContain('Initial body');
    expect(block('descendant').holder.textContent).toContain('Nested body');
  });

});
