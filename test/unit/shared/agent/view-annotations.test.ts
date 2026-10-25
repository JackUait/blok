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

  const failureOf = (name: `${string}.${string}`, args: Record<string, unknown>): AgentFailure['error'] | undefined => {
    try {
      run(name, args);
    } catch (error: unknown) {
      if (error instanceof AgentFailure) return error.error;
      throw error;
    }

    return undefined;
  };

  it.each([
    ['block.update', { id: 'n1', data: { text: [{ text: 'x' }] } }, 'n1'],
    ['block.delete', { id: 'n2' }, 'n2'],
    ['block.move', { id: 'n1', position: 'end' }, 'n1'],
    ['block.insert', { type: 'paragraph', parentId: 'n1' }, 'n1'],
    ['text.replace', { id: 'n2', field: 'text', with: 'x' }, 'n2'],
    ['doc.read', { ids: ['b1', 'n1'] }, 'n1'],
    ['doc.read', { rootId: 'n2' }, 'n2'],
    ['doc.find', { text: 'secret', rootId: 'n1' }, 'n1'],
  ])('refuses %s on a thread or a reply as a comment, not a missing block', (name, args, id) => {
    expect(failureOf(name as `${string}.${string}`, args)).toMatchObject({
      code: 'ANNOTATION_BLOCK',
      message: expect.stringMatching(/comment.*Agents do not read or write comments/),
      details: { id },
    });
  });

  it('names the thread a reply sits in', () => {
    expect(failureOf('block.delete', { id: 'n2' })?.message).toBe(
      'Block "n2" is inside note block "n1", a comment people left. Agents do not read or write comments.'
    );
    expect(failureOf('block.delete', { id: 'n1' })?.message).toBe(
      'Block "n1" is a note block, a comment people left. Agents do not read or write comments.'
    );
  });

  it('still says a block that is not there does not exist', () => {
    expect(failureOf('block.delete', { id: 'zz' })?.code).toBe('BLOCK_NOT_FOUND');
    expect(failureOf('doc.read', { ids: ['zz'] })?.code).toBe('BLOCK_NOT_FOUND');
  });
});
