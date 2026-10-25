// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure } from '../../../../src/shared/agent/errors';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { planOn, TOOLS, tool } from './fixtures';

import type { OutputData } from '../../../../types';

const tools = new Map([
  ...TOOLS,
  ['note', tool('note', {
    richTextFields: ['text'],
    children: { accepts: true, ownedByTool: false, layout: false, deletedWithParent: false, annotation: true },
  })],
]);

const doc: OutputData = {
  blocks: [
    { id: 't1', type: 'toggle', data: { text: [{ text: 'Section' }] }, content: ['b1', 'n1'] },
    { id: 'b1', type: 'paragraph', parent: 't1', data: { text: [{ text: 'Body text' }] } },
    { id: 'n1', type: 'note', parent: 't1', data: { text: [{ text: 'Thread secret' }] }, content: ['n2'] },
    { id: 'n2', type: 'paragraph', parent: 'n1', data: { text: [{ text: 'Reply secret' }] } },
  ],
};

const run = (name: `${string}.${string}`, args: Record<string, unknown>): unknown =>
  planOn(doc, [{ name, args }], { tools }).plan.results[0];

describe('agent reads skip annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the page without the thread or its replies', () => {
    const view = run('doc.read', {}) as { blocks: Array<{ id: string }> };

    expect(view.blocks.map((block) => block.id)).toEqual(['t1', 'b1']);
  });

  it('counts only page content as children', () => {
    const view = run('doc.read', { depth: 0 }) as { blocks: Array<{ id: string; childCount?: number }> };

    expect(view.blocks).toEqual([expect.objectContaining({ id: 't1', childCount: 1 })]);
  });

  it('never finds text in a thread', () => {
    expect(run('doc.find', { text: 'secret' })).toEqual({ count: 0, matches: [] });
  });

  it('keeps the thread in the saved document', () => {
    const ids = DocSnapshot.fromOutput(doc).toOutput().blocks.map((block) => block.id);

    expect(ids).toEqual(['t1', 'b1', 'n1', 'n2']);
  });

  it.each([
    ['block.update', { id: 'n1', data: { text: [{ text: 'x' }] } }],
    ['block.delete', { id: 'n2' }],
    ['block.move', { id: 'n1', position: 'end' }],
    ['block.insert', { type: 'paragraph', parentId: 'n1' }],
    ['text.replace', { id: 'n2', field: 'text', with: 'x' }],
  ])('refuses %s on a thread or a reply as a block it cannot see', (name, args) => {
    const code = ((): string | undefined => {
      try {
        run(name as `${string}.${string}`, args);
      } catch (error: unknown) {
        if (error instanceof AgentFailure) return error.error.code;
        throw error;
      }

      return undefined;
    })();

    expect(code).toBe('BLOCK_NOT_FOUND');
  });
});
