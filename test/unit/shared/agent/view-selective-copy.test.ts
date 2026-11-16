// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDocumentView, viewRows } from '../../../../src/shared/agent/document-view';
import { HANDLERS, planBatch, registerHandlers } from '../../../../src/shared/agent/planner';
import { richTextHelpers } from '../../../../src/shared/agent/rich-text-ops';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { plannerContext, TOOLS, tool } from './fixtures';

const context = { tools: TOOLS, richText: richTextHelpers };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('limited document reads', () => {
  it('does not prepare a mutable copy of unrelated payloads for a batch containing only core reads', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'first', type: 'paragraph', data: { text: [{ text: 'Visible' }] } },
      { id: 'heavy', type: 'paragraph', data: {} },
    ] });
    const heavy = snapshot.get('heavy');

    if (heavy === undefined) throw new Error('Missing fixture block');
    const readPayload = vi.fn(() => ({ nested: ['Unselected payload'] }));

    Object.defineProperty(heavy.data, 'payload', { enumerable: true, get: readPayload });
    const { plan } = planBatch({
      snapshot,
      batch: { commands: [{ name: 'doc.read', args: { limit: 1 } }, { name: 'doc.find', args: { type: 'paragraph' } }] },
      ctx: plannerContext(), stamp: { actorId: 'agent', at: 1 }, warnings: [],
    });

    expect(readPayload).not.toHaveBeenCalled();
    expect(plan.edits).toEqual([]);
    expect(plan.results).toHaveLength(2);
  });
  it('does not traverse payloads outside the requested page of results', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'first', type: 'paragraph', data: { text: [{ text: 'Visible' }] } },
      { id: 'heavy', type: 'paragraph', data: { text: [{ text: 'Outside the page' }] } },
    ] });
    const heavy = snapshot.get('heavy');

    if (heavy === undefined) throw new Error('Missing fixture block');
    const readPayload = vi.fn(() => Array.from({ length: 1000 }, () => ({ text: 'Large payload' })));

    // Instrument an otherwise ordinary JSON field after constructing the snapshot.
    Object.defineProperty(heavy.data, 'payload', { enumerable: true, get: readPayload });
    const view = buildDocumentView(snapshot, { limit: 1, detail: 'full' }, context, 'revision');

    expect(readPayload).not.toHaveBeenCalled();
    expect(view.blocks.map(block => block.id)).toEqual(['first']);
    expect(view.next).toBe('c:heavy');
  });

  it('detaches returned data, tunes and page metadata from later writes in both directions', () => {
    const snapshot = DocSnapshot.fromOutput({
      icon: { type: 'emoji', value: 'A' },
      cover: { type: 'image', url: 'https://example.com/a.png' },
      blocks: [{ id: 'first', type: 'paragraph', data: { text: [{ text: 'Before' }] }, tunes: { custom: { enabled: true } } }],
    });
    const before = buildDocumentView(snapshot, { limit: 1, detail: 'full' }, context, 'revision');
    const frozenAnswer = JSON.stringify(before);
    const block = snapshot.get('first');

    if (block === undefined || snapshot.icon === undefined) throw new Error('Missing fixture data');
    block.data.text = [{ text: 'After' }];
    block.tunes = { custom: { enabled: false } };
    snapshot.icon = { type: 'emoji', value: 'B' };
    expect(JSON.stringify(before)).toBe(frozenAnswer);

    const current = buildDocumentView(snapshot, { limit: 1, detail: 'full' }, context, 'revision');
    const saved = JSON.stringify(snapshot.toOutput());
    const returned = current.blocks[0];

    if (returned?.data === undefined || current.page === undefined) throw new Error('Missing returned data');
    returned.data.text = [{ text: 'Caller mutation' }];
    if (returned.tunes !== undefined) returned.tunes.custom = { enabled: 'mutated' };
    current.page.icon = { type: 'emoji', value: 'C' };
    if (current.page.cover?.type === 'image') current.page.cover.url = 'https://example.com/mutated.png';
    expect(JSON.stringify(snapshot.toOutput())).toBe(saved);
  });
});

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected nested record');
  return value as Record<string, unknown>;
};

it('detaches nested summary attributes even when full data is omitted', () => {
  const snapshot = DocSnapshot.fromOutput({blocks: [{id: 'custom', type: 'custom', data: {settings: {nested: {value: 'stored'}}}}]});
  const tools = new Map(TOOLS);

  tools.set('custom', tool('custom', {summaryFields: ['settings']}));
  const view = buildDocumentView(snapshot, {}, {...context, tools}, 'revision');
  const nested = record(record(view.blocks[0]?.attrs?.settings).nested);
  const source = record(record(snapshot.get('custom')?.data.settings).nested);

  expect(view.blocks[0]?.data).toBeUndefined();
  source.value = 'source mutation';
  expect(nested.value).toBe('stored');
  nested.value = 'caller mutation';
  expect(source.value).toBe('source mutation');
});

it('detaches row results and nested computed values while leaving all read helpers non-mutating', () => {
  const snapshot = DocSnapshot.fromOutput({blocks: [
    {id: 'db', type: 'database', data: {schema: [{id: 'author', type: 'createdBy', name: 'Author', position: 'a'}]}},
    {id: 'row', type: 'database-row', parent: 'db', createdBy: 'user', data: {properties: {custom: {value: 'stored'}}}, tunes: {custom: {value: 'tune'}}},
    {id: 'thread', type: 'database-comment', parent: 'row', data: {text: 'Original comment', authorId: 'user', createdAt: 1}},
  ]});
  const saved = JSON.stringify(snapshot.toOutput());
  const result = viewRows(snapshot, new Set(['row']), context, 1);
  const row = result.rows[0];

  expect(JSON.stringify(snapshot.toOutput())).toBe(saved);
  expect(row?.computed?.author).toEqual([{id: 'user'}]);
  expect(row?.comments?.threads[0]?.text).toBe('Original comment');
  expect(result.more).toBe(0);
  expect(result.rows).toEqual(buildDocumentView(snapshot, {ids: ['row']}, context, 'revision').blocks);
  const properties = record(row?.data?.properties);
  const source = record(snapshot.get('row')?.data.properties);
  record(source.custom).value = 'source mutation';
  expect(record(properties.custom).value).toBe('stored');
  record(properties.custom).value = 'caller mutation';
  record(row?.tunes?.custom).value = 'caller tune';
  const people = row?.computed?.author;

  if (!Array.isArray(people)) throw new Error('Missing computed people');
  record(people[0]).id = 'caller person';
  const thread = row?.comments?.threads[0];

  if (thread === undefined) throw new Error('Missing comment');
  thread.text = 'Caller comment';
  expect(record(source.custom).value).toBe('source mutation');
  expect(record(snapshot.get('row')?.tunes?.custom).value).toBe('tune');
  expect(snapshot.get('thread')?.data.text).toBe('Original comment');
  expect(viewRows(snapshot, new Set(['row']), context, 1).rows[0]?.computed?.author).toEqual([{id: 'user'}]);
});

it('keeps a private draft for an overwritten core read handler', () => {
  const snapshot = DocSnapshot.fromOutput({blocks: [{id: 'p', type: 'paragraph', data: {text: [{text: 'Original'}]}}]});
  const original = HANDLERS['doc.read'];

  if (original === undefined) throw new Error('Missing core handler');
  try {
    registerHandlers({'doc.read': state => {
      const block = state.draft.get('p');

      if (block === undefined) throw new Error('Missing fixture block');
      block.data.text = [{text: 'Custom handler mutation'}];
      return {};
    }});
    planBatch({snapshot, batch: {commands: [{name: 'doc.read', args: {}}]}, ctx: plannerContext(), stamp: {actorId: 'agent', at: 1}, warnings: []});
    expect(snapshot.get('p')?.data.text).toEqual([{text: 'Original'}]);
  } finally {
    registerHandlers({'doc.read': original});
  }
});
