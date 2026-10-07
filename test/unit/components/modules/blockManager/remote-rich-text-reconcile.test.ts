/**
 * A peer's update re-renders a block only when the block's rich text really
 * changed. Readers spell rich fields as canonical HTML (`<strong>`) while a
 * saved block keeps the tool's spelling (`<b>`), so the reconciler must
 * compare rich fields as segments, never as strings.
 *
 * Real Core with real tools; the peer is a second DocumentStore whose updates
 * arrive through `YjsManager.applyRemoteUpdate`, the provider's entry point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { BlokConfig } from '../../../../../types';
import { Core } from '../../../../../src/components/core';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Block } from '../../../../../src/components/block';

const PEER_ORIGIN = 'test-provider';

/** The doc is private; the cleanup test needs a deep observer on it. */
interface PrivateYjsManager {
  documentStore: { ydoc: Y.Doc };
}

const holders: HTMLElement[] = [];
const booted: Core[] = [];

const waitFor = async (predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const destroy = (moduleInstance as { destroy?: () => void }).destroy;

    if (typeof destroy === 'function') {
      try {
        destroy.call(moduleInstance);
      } catch {
        /* teardown is best effort */
      }
    }
  });
};

interface Booted {
  core: Core;
  peer: DocumentStore;
  holder: HTMLElement;
  deliver: () => void;
}

const boot = async (
  tools: BlokConfig['tools'],
  blocks: { id: string; type: string; data: Record<string, unknown> }[],
  config: Partial<BlokConfig> = {}
): Promise<Booted> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const core = new Core({ ...config, holder, minHeight: 50, tools, data: { blocks } });

  await core.isReady;
  booted.push(core);

  const manager = core.moduleInstances.YjsManager;
  const peer = new DocumentStore(new YBlockSerializer());

  peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));

  const deliver = (): void => {
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()), PEER_ORIGIN);
  };

  return { core, peer, holder, deliver };
};

const blockById = (core: Core, id: string): Block => {
  const block = core.moduleInstances.BlockManager.getBlockById(id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block;
};

/**
 * Make the block hold `html` in the tool's own spelling — what a user's
 * formatting leaves in the DOM — and save it, the way the mutation path does.
 * The local document gets the same content, so both sides agree on segments.
 */
const respellLocally = async (core: Core, block: Block, html: string): Promise<void> => {
  const editable = block.pluginsContent;

  editable.innerHTML = html;
  await block.save();
  core.moduleInstances.YjsManager.updateBlockData(block.id, 'text', html);
};

/** A rich-text tool whose save spells bold `<b>`, never the canonical `<strong>`. */
class BoldAsB {
  public static richTextFields = ['text'];
  private readonly element = document.createElement('div');

  constructor({ data }: { data: { text?: string } }) {
    this.element.setAttribute('contenteditable', 'true');
    this.element.innerHTML = this.respell(data.text ?? '');
  }

  public render(): HTMLElement {
    return this.element;
  }

  public setData(data: { text?: string }): void {
    this.element.innerHTML = this.respell(data.text ?? '');
  }

  public save(): { text: string } {
    return { text: this.respell(this.element.innerHTML) };
  }

  private respell(html: string): string {
    return html.replace(/<(\/?)strong>/g, '<$1b>');
  }
}

/**
 * yjs's format cleanup only changes the doc once an observer has read a text
 * event's delta (measured); a plain observer is not enough.
 */
const readTextDeltas = (ydoc: Y.Doc): unknown[] => {
  const deltas: unknown[] = [];

  ydoc.getMap('blocks').observeDeep((events) => {
    events.forEach((event) => {
      if (event instanceof Y.YTextEvent) {
        deltas.push(event.delta);
      }
    });
  });

  return deltas;
};

const setDataSpy = (block: Block): ReturnType<typeof vi.spyOn> => vi.spyOn(block, 'setData');

describe('reconciling a peer update into a rich text block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it('re-renders the block when a peer bolds a word', async () => {
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [{ id: 'b1', type: 'paragraph', data: { text: 'hello world' } }]
    );
    const editable = blockById(core, 'b1').pluginsContent;

    editable.setAttribute('contenteditable', 'true');

    peer.updateBlockData('b1', 'text', 'hello <b>world</b>');
    deliver();

    await waitFor(() => editable.querySelector('strong, b') !== null, 'the bold word');

    expect(editable.querySelector('strong, b')?.textContent).toBe('world');
    expect(editable.textContent).toBe('hello world');
  }, 30_000);

  it('keeps the tool\'s own spelling when a peer touches the block without changing its text', async () => {
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [{ id: 'b1', type: 'paragraph', data: { text: 'hello world' } }]
    );
    const block = blockById(core, 'b1');

    block.pluginsContent.setAttribute('contenteditable', 'true');
    await respellLocally(core, block, 'hello <b>world</b>');

    // The premise: the block holds `<b>`, the document reads back `<strong>`.
    expect(block.preservedData.text).toBe('hello <b>world</b>');

    peer.applyRemoteUpdate(core.moduleInstances.YjsManager.encodeStateAsUpdate(peer.getStateVector()));

    const setData = setDataSpy(block);

    peer.updateBlockMetadata('b1', Date.now(), 'someone-else');
    deliver();
    await settle();

    expect(setData).not.toHaveBeenCalled();
    expect(block.pluginsContent.innerHTML).toBe('hello <b>world</b>');
  }, 30_000);

  it('keeps the tool\'s own spelling when a peer types in another block', async () => {
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [
        { id: 'b1', type: 'paragraph', data: { text: 'hello world' } },
        { id: 'b2', type: 'paragraph', data: { text: 'other' } },
      ]
    );
    const block = blockById(core, 'b1');

    block.pluginsContent.setAttribute('contenteditable', 'true');
    await respellLocally(core, block, 'hello <b>world</b>');
    peer.applyRemoteUpdate(core.moduleInstances.YjsManager.encodeStateAsUpdate(peer.getStateVector()));

    const setData = setDataSpy(block);

    peer.updateBlockData('b2', 'text', 'other typed');
    deliver();
    await waitFor(() => blockById(core, 'b2').pluginsContent.textContent === 'other typed', 'the peer\'s typing');
    await settle();

    expect(setData).not.toHaveBeenCalled();
    expect(block.pluginsContent.innerHTML).toBe('hello <b>world</b>');
  }, 30_000);

  it('does not rewrite the block when a peer bolds the same word at the same time', async () => {
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [{ id: 'b1', type: 'paragraph', data: { text: 'hello world' } }]
    );
    const block = blockById(core, 'b1');

    block.pluginsContent.setAttribute('contenteditable', 'true');

    // Both sides bold "world" before seeing each other's edit.
    await respellLocally(core, block, 'hello <b>world</b>');
    peer.updateBlockData('b1', 'text', 'hello <b>world</b>');

    const setData = setDataSpy(block);

    deliver();
    await settle();

    expect(setData).not.toHaveBeenCalled();
    expect(block.pluginsContent.innerHTML).toBe('hello <b>world</b>');
  }, 30_000);

  it('does not rewrite the block for yjs\'s own format cleanup', async () => {
    const text = 'The quick brown fox jumps';
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [{ id: 'b1', type: 'paragraph', data: { text } }]
    );
    const block = blockById(core, 'b1');
    const ydoc = (core.moduleInstances.YjsManager as unknown as PrivateYjsManager).documentStore.ydoc;
    const origins: unknown[] = [];

    block.pluginsContent.setAttribute('contenteditable', 'true');

    readTextDeltas(ydoc);

    // Local bolds 4..15, the peer 10..19, concurrently. The merge keeps this
    // side's segments as they were; only the cleanup touches the text.
    await respellLocally(core, block, 'The <b>quick brown</b> fox jumps');
    peer.updateBlockData('b1', 'text', 'The quick <b>brown fox</b> jumps');

    const setData = setDataSpy(block);
    const stop = core.moduleInstances.YjsManager.onAnyDocUpdate((_update, origin) => {
      origins.push(origin);
    });

    deliver();
    await settle();
    stop();

    expect(setData).not.toHaveBeenCalled();
    expect(block.pluginsContent.innerHTML).toBe('The <b>quick brown</b> fox jumps');
    // The premise: a cleanup really changed the doc on this side.
    expect(origins).toContain(null);
  }, 30_000);

  it('rewrites once when a peer\'s edit and the cleanup it causes arrive together', async () => {
    const text = 'The quick brown fox jumps';
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [{ id: 'b1', type: 'paragraph', data: { text } }]
    );
    const block = blockById(core, 'b1');
    const ydoc = (core.moduleInstances.YjsManager as unknown as PrivateYjsManager).documentStore.ydoc;
    const origins: unknown[] = [];

    block.pluginsContent.setAttribute('contenteditable', 'true');
    readTextDeltas(ydoc);

    await respellLocally(core, block, 'The <b>quick brown</b> fox jumps');
    peer.updateBlockData('b1', 'text', 'The quick <b>brown fox</b> jumps now');

    const setData = setDataSpy(block);
    const stop = core.moduleInstances.YjsManager.onAnyDocUpdate((_update, origin) => {
      origins.push(origin);
    });

    deliver();
    await waitFor(() => (block.pluginsContent.textContent ?? '').endsWith('now'), 'the peer\'s text');
    await settle();
    stop();

    expect(setData).toHaveBeenCalledTimes(1);
    expect(block.pluginsContent.querySelector('strong, b')?.textContent).toBe('quick brown');
    expect(origins).toContain(null);
  }, 30_000);

  it('reports a peer\'s edit to a block holding a non-breaking space as the peer\'s', async () => {
    const changes: unknown[] = [];
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [{ id: 'b1', type: 'paragraph', data: { text: 'a\u00a0b' } }],
      {
        onChange: (_api, event) => {
          changes.push(...(Array.isArray(event) ? event : [event]));
        },
      }
    );
    const block = blockById(core, 'b1');

    block.pluginsContent.setAttribute('contenteditable', 'true');
    await new Promise((resolve) => setTimeout(resolve, 500));
    changes.splice(0);

    // The DOM spells the space `&nbsp;`, the doc reads it back as U+00A0.
    peer.updateBlockData('b1', 'text', 'a\u00a0b typed');
    deliver();
    await waitFor(() => (block.pluginsContent.textContent ?? '').endsWith('typed'), 'the peer\'s text');
    await new Promise((resolve) => setTimeout(resolve, 600));

    const origins = changes
      .map((event) => (event as CustomEvent<{ target: { id: string }; origin: string }>).detail)
      .filter((detail) => detail.target.id === 'b1')
      .map((detail) => detail.origin);

    expect(origins).toEqual(['remote']);
  }, 30_000);

  it('reports a peer\'s bold as the peer\'s in a tool that saves its own spelling', async () => {
    const changes: unknown[] = [];
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph }, note: { class: BoldAsB } },
      [{ id: 'b1', type: 'note', data: { text: 'hello world' } }],
      {
        onChange: (_api, event) => {
          changes.push(...(Array.isArray(event) ? event : [event]));
        },
      }
    );
    const block = blockById(core, 'b1');

    await new Promise((resolve) => setTimeout(resolve, 500));
    changes.splice(0);

    peer.updateBlockData('b1', 'text', 'hello <b>world</b>');
    deliver();
    await waitFor(() => block.pluginsContent.querySelector('b') !== null, 'the peer\'s bold');
    await new Promise((resolve) => setTimeout(resolve, 600));

    const origins = changes
      .map((event) => (event as CustomEvent<{ target: { id: string }; origin: string }>).detail)
      .filter((detail) => detail.target.id === 'b1')
      .map((detail) => detail.origin);

    expect(origins).toEqual(['remote']);
  }, 30_000);

  it('does not rewrite a block holding an equation and a page mention when a peer touches it', async () => {
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [{
        id: 'b1',
        type: 'paragraph',
        data: {
          text: [
            { text: 'x ' },
            { embed: { equation: { expression: 'a^2' } } },
            { text: ' y ' },
            { embed: { page: { id: 'p1' } } },
            { text: ' z' },
          ],
        },
      }]
    );
    const block = blockById(core, 'b1');

    block.pluginsContent.setAttribute('contenteditable', 'true');
    await block.save();
    peer.applyRemoteUpdate(core.moduleInstances.YjsManager.encodeStateAsUpdate(peer.getStateVector()));

    const setData = setDataSpy(block);

    peer.updateBlockMetadata('b1', Date.now(), 'someone-else');
    deliver();
    await settle();

    expect(setData).not.toHaveBeenCalled();
    // The premise: both embeds survived into what the block holds.
    expect(block.preservedData.text).toContain('data-latex="a^2"');
    expect(block.preservedData.text).toContain('data-blok-page-id="p1"');
    expect(core.moduleInstances.YjsManager.richSegmentsOf(block.preservedData.text)).toEqual(
      core.moduleInstances.YjsManager.richSegmentsOf(core.moduleInstances.YjsManager.getBlockDataObject('b1')?.text)
    );
  }, 30_000);

  it('keeps the local caret when a peer types later in the same block', async () => {
    const { core, peer, deliver } = await boot(
      { paragraph: { class: Paragraph } },
      [{ id: 'b1', type: 'paragraph', data: { text: 'hello <b>world</b>' } }]
    );
    const block = blockById(core, 'b1');
    const editable = block.pluginsContent;

    editable.setAttribute('contenteditable', 'true');

    const first = editable.firstChild;

    if (first === null) {
      throw new Error('the block rendered no text node');
    }

    const selection = document.getSelection();

    if (selection === null) {
      throw new Error('jsdom has no selection');
    }

    const range = document.createRange();

    range.setStart(first, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    peer.updateBlockData('b1', 'text', 'hello <b>world</b> again');
    deliver();

    await waitFor(() => (editable.textContent ?? '').includes('again'), 'the peer\'s text');
    await settle();

    const live = document.getSelection();

    expect({
      inside: live !== null && live.rangeCount > 0 && editable.contains(live.anchorNode),
      text: live?.anchorNode?.textContent ?? null,
      offset: live?.anchorOffset ?? null,
    }).toEqual({ inside: true, text: 'hello ', offset: 3 });
    expect(editable.querySelector('strong, b')?.textContent).toBe('world');
  }, 30_000);
});
