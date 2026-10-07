// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { diffOutputData } from '../../../src/view';

import type { LooseOutputData, OutputBlockData, OutputData } from '../../../types';

const paragraph = (id: string, text: unknown, extra: Partial<OutputBlockData> = {}): OutputBlockData =>
  ({ id, type: 'paragraph', data: { text }, ...extra });

const doc = (...blocks: OutputBlockData[]): OutputData => ({ blocks });

const EMPTY = { added: [], removed: [], changed: [], moved: [] };

describe('diffOutputData', () => {
  it('finds nothing between identical documents', () => {
    const blocks = [paragraph('a', 'one'), paragraph('b', 'two', { parent: 'a' })];

    expect(diffOutputData(doc(...blocks), doc(...blocks))).toEqual(EMPTY);
  });

  it('lists added blocks in after order and removed blocks in before order', () => {
    const before = doc(paragraph('r1', 'x'), paragraph('k', 'k'), paragraph('r2', 'y'));
    const after = doc(paragraph('n1', 'p'), paragraph('k', 'k'), paragraph('n2', 'q'));

    expect(diffOutputData(before, after)).toEqual({
      added: [paragraph('n1', 'p'), paragraph('n2', 'q')],
      removed: [paragraph('r1', 'x'), paragraph('r2', 'y')],
      changed: [],
      moved: [],
    });
  });

  it('reports a data change', () => {
    const before = paragraph('a', 'old');
    const after = paragraph('a', 'new');

    expect(diffOutputData(doc(before), doc(after))).toEqual({
      ...EMPTY,
      changed: [{ id: 'a', before, after, fields: ['data'] }],
    });
  });

  it('reports type and tunes changes, and treats missing tunes as empty', () => {
    const typedBefore: OutputBlockData = { id: 't', type: 'paragraph', data: { text: 'x' } };
    const typedAfter: OutputBlockData = { id: 't', type: 'header', data: { text: 'x' } };
    const tunedBefore = paragraph('u', 'y', { tunes: { align: { value: 'left' } } });
    const tunedAfter = paragraph('u', 'y', { tunes: { align: { value: 'right' } } });
    const bare = paragraph('v', 'z');
    const emptyTunes = paragraph('v', 'z', { tunes: {} });

    expect(diffOutputData(doc(typedBefore, tunedBefore, bare), doc(typedAfter, tunedAfter, emptyTunes))).toEqual({
      ...EMPTY,
      changed: [
        { id: 't', before: typedBefore, after: typedAfter, fields: ['type'] },
        { id: 'u', before: tunedBefore, after: tunedAfter, fields: ['tunes'] },
      ],
    });
  });

  it('treats HTML and segments with the same content as equal', () => {
    const before = doc(paragraph('p', '<b>hi</b>'));
    const after = doc(paragraph('p', [{ text: 'hi', marks: { bold: true } }]));

    expect(diffOutputData(before, after)).toEqual(EMPTY);
  });

  it('canonicalizes a custom tool field only when richTextFields names it', () => {
    const before = doc({ id: 'n', type: 'note', data: { body: '<b>x</b>' } });
    const after = doc({ id: 'n', type: 'note', data: { body: [{ text: 'x', marks: { bold: true } }] } });

    expect(diffOutputData(before, after, { richTextFields: type => type === 'note' ? ['body'] : [] })).toEqual(EMPTY);
    expect(diffOutputData(before, after)).toEqual({
      ...EMPTY,
      changed: [{ id: 'n', before: before.blocks[0], after: after.blocks[0], fields: ['data'] }],
    });
  });

  it('moves only the block outside the longest kept order when two roots swap', () => {
    const a = paragraph('a', 'A');
    const b = paragraph('b', 'B');

    expect(diffOutputData(doc(a, b), doc(b, a))).toEqual({
      ...EMPTY,
      moved: [{ id: 'b', before: b, after: b }],
    });
  });

  it('reports a parent change as a move, and a moved block can also be changed', () => {
    const container = paragraph('c', 'C');
    const before = paragraph('x', 'old');
    const after = paragraph('x', 'new', { parent: 'c' });

    expect(diffOutputData(doc(container, before), doc(paragraph('c', 'C', { content: ['x'] }), after))).toEqual({
      ...EMPTY,
      changed: [{ id: 'x', before, after, fields: ['data'] }],
      moved: [{ id: 'x', before, after }],
    });
  });

  it('never matches id-less blocks, and a later duplicate id counts as id-less', () => {
    const idless: OutputBlockData = { type: 'paragraph', data: { text: 'same' } };
    const first = paragraph('d', 'first');
    const duplicateBefore = paragraph('d', 'stale');
    const duplicateAfter = paragraph('d', 'fresh');

    expect(diffOutputData(doc(idless, first, duplicateBefore), doc(idless, first, duplicateAfter))).toEqual({
      added: [idless, duplicateAfter],
      removed: [idless, duplicateBefore],
      changed: [],
      moved: [],
    });
  });

  it('ignores indent, content, edit stamps and document envelope fields', () => {
    const before: OutputData = {
      id: 'doc-1',
      time: 1,
      version: '1.0.0',
      blocks: [paragraph('a', 'x', { indent: 1, content: ['b'], lastEditedAt: 1, lastEditedBy: 'u1' }), paragraph('b', 'y', { parent: 'a' })],
    };
    const after: OutputData = {
      id: 'doc-2',
      time: 2,
      version: '2.0.0',
      blocks: [paragraph('a', 'x', { indent: 2, lastEditedAt: 2, lastEditedBy: 'u2' }), paragraph('b', 'y', { parent: 'a' })],
    };

    expect(diffOutputData(before, after)).toEqual(EMPTY);
  });

  it('treats null and undefined documents as having no blocks', () => {
    const a = paragraph('a', 'A');

    expect(diffOutputData(null, undefined)).toEqual(EMPTY);
    expect(diffOutputData(null, doc(a))).toEqual({ ...EMPTY, added: [a] });
    expect(diffOutputData(doc(a), undefined)).toEqual({ ...EMPTY, removed: [a] });
  });

  it('normalizes the loose wire shape: null id is unmatched, null data equals {}', () => {
    const before: LooseOutputData = {
      blocks: [
        { id: null, type: 'paragraph', data: null },
        { id: 'k', type: 'delimiter', data: null },
      ],
    };
    const after: LooseOutputData = { blocks: [{ id: 'k', type: 'delimiter', data: {} }] };

    expect(diffOutputData(before, after)).toEqual({
      ...EMPTY,
      removed: [{ type: 'paragraph', data: {} }],
    });
  });

  it('keeps children of each parent in their own order', () => {
    const parent = paragraph('p', 'P');
    const one = paragraph('c1', '1', { parent: 'p' });
    const two = paragraph('c2', '2', { parent: 'p' });
    const three = paragraph('c3', '3', { parent: 'p' });
    const root = paragraph('r', 'R');

    // Children 3,1,2 keep 1 and 2; the root sibling list is unchanged.
    expect(diffOutputData(doc(parent, one, two, three, root), doc(parent, three, one, two, root))).toEqual({
      ...EMPTY,
      moved: [{ id: 'c3', before: three, after: three }],
    });
  });
});
