/**
 * Core must never mutate or retain caller-owned document data.
 *
 * Host apps pass `data` straight from their state stores (Redux/Immer state is
 * often deep-frozen). The editor must deep-clone that data at its public
 * boundaries: constructing with frozen data must not throw, and no editor
 * operation — including tools mutating "their" data and hierarchy ops that
 * push/splice contentIds — may write through to the caller's objects.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Blok } from '../../../../src/blok';
import type { BlokConfig, OutputData } from '../../../../types';
import type { Blocks } from '../../../../types/api';

/**
 * The blocks API is attached to the instance dynamically by exportAPI(),
 * so it is not part of the Blok class type.
 * @param editor - ready editor instance
 */
const blocksApiOf = (editor: Blok): Blocks => {
  return (editor as unknown as { blocks: Blocks }).blocks;
};

/**
 * Recursively freezes a value so any in-place mutation throws (strict mode).
 * @param value - object/array to freeze
 */
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }

  return value;
};

/**
 * A sanitize-rule-less tool (no static sanitize config) that treats the data
 * it receives as its own and mutates it during render — the aliasing trap:
 * without a boundary clone this write lands on the caller's object.
 */
const PLAIN_TOOL = class PlainTool {
  private data: Record<string, unknown>;

  constructor({ data }: { data: Record<string, unknown> }) {
    this.data = data;
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.textContent = typeof this.data.label === 'string' ? this.data.label : '';
    this.data.touchedByTool = true;

    return wrapper;
  }

  public save(): Record<string, unknown> {
    return this.data;
  }
};

/**
 * Hierarchical document whose reconcile pass mutates contentIds in place:
 * `c2` points at `p1` but is missing from p1's `content` array, so insertMany
 * pushes into that array — which aliases the caller's array without the fix.
 */
const buildDocument = (): OutputData => ({
  blocks: [
    {
      id: 'p1',
      type: 'plain',
      data: { label: 'parent' },
      tunes: { marker: { hue: 120 } },
      content: [ 'c1' ],
    },
    {
      id: 'c1',
      type: 'plain',
      data: { label: 'child', nested: { keep: true } },
      parent: 'p1',
    },
    {
      id: 'c2',
      type: 'plain',
      data: { label: 'stray child' },
      parent: 'p1',
    },
  ],
});

describe('caller-owned document data immutability', () => {
  let holder: HTMLElement;
  let editor: Blok | null = null;

  beforeEach(() => {
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    if (editor !== null) {
      await editor.isReady;
      editor.destroy();
      editor = null;
    }
    holder.remove();
  });

  const createEditor = (data: OutputData): Blok => {
    return new Blok({
      holder,
      tools: { plain: PLAIN_TOOL },
      data,
    } as unknown as BlokConfig);
  };

  it('boots from deep-frozen caller data without throwing and leaves it untouched', async () => {
    const callerData = buildDocument();
    const snapshot = structuredClone(callerData);

    deepFreeze(callerData);

    editor = createEditor(callerData);
    await editor.isReady;

    expect(callerData).toEqual(snapshot);
  });

  it('blocks.render() accepts deep-frozen data and leaves it untouched', async () => {
    editor = createEditor(buildDocument());
    await editor.isReady;

    const renderData = buildDocument();
    const snapshot = structuredClone(renderData);

    deepFreeze(renderData);

    await blocksApiOf(editor).render(renderData);

    expect(renderData).toEqual(snapshot);
  });

  it('contentIds-mutating operations never write through to the caller arrays', async () => {
    const callerData = buildDocument();
    const snapshot = structuredClone(callerData);

    editor = createEditor(callerData);
    await editor.isReady;

    // Insert a new child under p1 (pushes into the parent's contentIds).
    blocksApiOf(editor).insert('plain', { label: 'inserted' });

    // Remove the parent block — its children get promoted (contentIds splice).
    const parentIndex = blocksApiOf(editor).getBlockIndex('p1');

    if (parentIndex !== undefined && parentIndex >= 0) {
      await blocksApiOf(editor).delete(parentIndex);
    }

    expect(callerData).toEqual(snapshot);
  });

  it('a sanitize-rule-less tool mutating its data never corrupts the caller object', async () => {
    const callerData = buildDocument();
    const snapshot = structuredClone(callerData);

    editor = createEditor(callerData);
    await editor.isReady;

    // PLAIN_TOOL sets data.touchedByTool during render; with aliasing this
    // write would appear on the caller's data object.
    expect(callerData).toEqual(snapshot);
  });
});
