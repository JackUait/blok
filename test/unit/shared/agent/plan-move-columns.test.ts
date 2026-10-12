// @vitest-environment node
// Imports target test/unit/shared/agent when installed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocumentAgentSession } from '../../../../src/shared/agent/document-session';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { createHeadlessAgentSetup } from '../../../../src/view/agent-runtime';
import type { AgentSession, OutputData } from '../../../../types';

const columnDocument = (nested = false): OutputData => ({
  blocks: [
    { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
    ...(nested ? [
      { id: 'outer-list', type: 'column_list', data: {}, content: ['outer-c1', 'outer-c2'] },
      { id: 'outer-c1', type: 'column', data: {}, parent: 'outer-list', content: ['left', 'cl', 'right'] },
      { id: 'left', type: 'paragraph', data: { text: [{ text: 'Left' }] }, parent: 'outer-c1' },
    ] : []),
    { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'], ...(nested ? { parent: 'outer-c1' } : {}) },
    { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x'] },
    { id: 'x', type: 'paragraph', data: { text: [{ text: 'X', marks: { bold: true } }] }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['y', 'z'] },
    { id: 'y', type: 'paragraph', data: { text: [{ text: 'Y' }] }, parent: 'c2' },
    { id: 'z', type: 'paragraph', data: { text: [{ text: 'Z' }] }, parent: 'c2' },
    ...(nested ? [
      { id: 'right', type: 'paragraph', data: { text: [{ text: 'Right' }] }, parent: 'outer-c1' },
      { id: 'outer-c2', type: 'column', data: {}, parent: 'outer-list', content: ['outer-other'] },
      { id: 'outer-other', type: 'paragraph', data: { text: [{ text: 'Other' }] }, parent: 'outer-c2' },
    ] : []),
    { id: 'q', type: 'paragraph', data: { text: [{ text: 'Q' }] } },
  ],
});

const layouts = [
  { name: 'root', nested: false },
  { name: 'nested column', nested: true },
];

const sessions: AgentSession[] = [];

const openSession = (document: OutputData) => {
  const { contract, tools, ports } = createHeadlessAgentSetup();
  const session = createDocumentAgentSession({
    document, contract, tools, ports,
    actor: { id: 'agent-1', name: 'Agent', kind: 'agent' },
  });

  sessions.push(session);

  return session;
};

describe('block.move across existing columns in JSON', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      sessions.splice(0).forEach(session => session.close());
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('moves an existing root block into an existing column', async () => {
    const session = openSession(columnDocument());
    const result = await session.execute({ commands: [
      { name: 'block.move', args: { id: 'p', parentId: 'c1', position: 'end' } },
    ] });
    const saved = DocSnapshot.fromOutput(session.output());

    expect(saved.childrenOf('c1')).toEqual(['x', 'p']);
    expect(saved.parentOf('p')).toBe('c1');
    expect(saved.childrenOf(null)).toEqual(['cl', 'q']);
    expect(saved.childrenOf('cl')).toEqual(['c1', 'c2']);
    expect(saved.childrenOf('c2')).toEqual(['y', 'z']);
    expect(saved.get('p')?.data).toEqual({ text: [{ text: 'P' }] });
    expect(result).toMatchObject({ ok: true });
  });

  it('keeps a column that still contains another block after the move', async () => {
    const session = openSession(columnDocument());
    const result = await session.execute({ commands: [
      { name: 'block.move', args: { id: 'p', parentId: 'c1', position: 'end' } },
      { name: 'block.move', args: { id: 'x', parentId: null, position: 'end' } },
    ] });

    expect(result).toMatchObject({ ok: true });
    const saved = DocSnapshot.fromOutput(session.output());

    expect(saved.parentOf('x')).toBe(null);
    expect(saved.childrenOf(null).slice(-1)).toEqual(['x']);
    expect(saved.childrenOf('c1')).toEqual(['p']);
    expect(saved.childrenOf('cl')).toEqual(['c1', 'c2']);
    expect(saved.childrenOf('c2')).toEqual(['y', 'z']);
    expect(saved.childrenOf(null)).toEqual(['cl', 'q', 'x']);
    expect(saved.parentOf('x')).toBe(null);
    expect(saved.get('x')?.data).toEqual({ text: [{ text: 'X', marks: { bold: true } }] });
  });

  it('removes the emptied column without unwrapping two surviving columns', async () => {
    const document: OutputData = { blocks: [
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2', 'c3'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x'] },
      { id: 'x', type: 'paragraph', data: { text: [{ text: 'X' }] }, parent: 'c1' },
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['y'] },
      { id: 'y', type: 'paragraph', data: { text: [{ text: 'Y' }] }, parent: 'c2' },
      { id: 'c3', type: 'column', data: { widthRatio: 2 }, parent: 'cl', content: ['z'] },
      { id: 'z', type: 'paragraph', data: { text: [{ text: 'Z' }] }, parent: 'c3' },
    ] };
    const session = openSession(document);
    const result = await session.execute({ commands: [
      { name: 'block.move', args: { id: 'x', parentId: null, position: 'end' } },
    ] });

    expect(result).toMatchObject({ ok: true });
    const saved = DocSnapshot.fromOutput(session.output());

    expect(saved.parentOf('x')).toBe(null);
    expect(saved.childrenOf(null).slice(-1)).toEqual(['x']);
    expect(saved.has('c1')).toBe(false);
    expect(saved.childrenOf('cl')).toEqual(['c2', 'c3']);
    expect(saved.childrenOf(null)).toEqual(['cl', 'x']);
    expect(saved.parentOf('y')).toBe('c2');
    expect(saved.parentOf('z')).toBe('c3');
    expect(saved.get('c3')?.data).toEqual({ widthRatio: 2 });
    expect(saved.toOutput().blocks.map(block => block.id)).toEqual(['cl', 'c2', 'y', 'c3', 'z', 'x']);
  });

  it.each(layouts)('unwraps a single surviving column at its list slot in the $name', async ({ nested }) => {
    const session = openSession(columnDocument(nested));
    const result = await session.execute({ commands: [
      { name: 'block.move', args: { id: 'x', parentId: null, position: 'end' } },
    ] });

    expect(result).toMatchObject({ ok: true });
    const saved = DocSnapshot.fromOutput(session.output());

    expect(saved.parentOf('x')).toBe(null);
    expect(saved.childrenOf(null).slice(-1)).toEqual(['x']);
    expect(saved.has('c1')).toBe(false);
    expect(saved.has('cl')).toBe(false);
    expect(saved.has('c2')).toBe(false);
    if (nested) {
      expect(saved.childrenOf(null)).toEqual(['p', 'outer-list', 'q', 'x']);
      expect(saved.childrenOf('outer-list')).toEqual(['outer-c1', 'outer-c2']);
      expect(saved.childrenOf('outer-c1')).toEqual(['left', 'y', 'z', 'right']);
      expect(saved.childrenOf('outer-c2')).toEqual(['outer-other']);
      expect(saved.parentOf('y')).toBe('outer-c1');
      expect(saved.parentOf('z')).toBe('outer-c1');
      expect(saved.toOutput().blocks.map(block => block.id)).toEqual([
        'p', 'outer-list', 'outer-c1', 'left', 'y', 'z', 'right', 'outer-c2', 'outer-other', 'q', 'x',
      ]);
    } else {
      expect(saved.childrenOf(null)).toEqual(['p', 'y', 'z', 'q', 'x']);
      expect(saved.parentOf('y')).toBe(null);
      expect(saved.parentOf('z')).toBe(null);
      expect(saved.toOutput().blocks.map(block => block.id)).toEqual(['p', 'y', 'z', 'q', 'x']);
    }
    expect(saved.parentOf('x')).toBe(null);
    expect(saved.get('x')?.data).toEqual({ text: [{ text: 'X', marks: { bold: true } }] });
    expect(saved.get('y')?.data).toEqual({ text: [{ text: 'Y' }] });
    expect(saved.get('z')?.data).toEqual({ text: [{ text: 'Z' }] });
  });
});
