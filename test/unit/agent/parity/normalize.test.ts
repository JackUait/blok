import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlokEventMap } from '../../../../src/components/events';
import { YjsManager } from '../../../../src/components/modules/yjs';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import { applyEdits } from '../../../../src/shared/agent/json-applier';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import type { OutputData } from '../../../../types';

import { CORPUS_ROOT } from './corpus';
import { normalizeForParity, stableStringify } from './normalize';

type NormalizerCase = {
  name: string;
  keepIds: string[];
  input: OutputData;
  expected: unknown;
  tsOnly?: string;
};

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isNormalizerCase = (value: unknown): value is NormalizerCase =>
  isRecord(value)
  && typeof value.name === 'string'
  && isArray(value.keepIds)
  && value.keepIds.every((id) => typeof id === 'string')
  && isRecord(value.input)
  && isArray(value.input.blocks)
  && value.input.blocks.every((block) =>
    isRecord(block) && isRecord(block.data)
    && (block.tunes === undefined || isRecord(block.tunes)))
  && (value.input.icon === undefined || isRecord(value.input.icon))
  && validateAgainst(blokDocumentSchema, value.input).length === 0
  && Object.prototype.hasOwnProperty.call(value, 'expected')
  && (value.tsOnly === undefined || typeof value.tsOnly === 'string');

const fixture: unknown = JSON.parse(readFileSync(join(CORPUS_ROOT, 'normalizer-cases.json'), 'utf8'));

if (!isRecord(fixture) || !isArray(fixture.cases) || !fixture.cases.every(isNormalizerCase)) {
  throw new Error('Invalid normalizer fixtures');
}

const cases = fixture.cases;

describe('normalizeForParity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(cases)('$name', ({ input, keepIds, expected }) => {
    expect(normalizeForParity(input, new Set(keepIds))).toEqual(expected);
  });

  it('renames table cell references by structural position when the root id is kept', () => {
    const doc: OutputData = {
      blocks: [
        {
          id: 't',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [[{ blocks: ['m1'] }]],
          },
          content: ['m1'],
        },
        {
          id: 'm1',
          type: 'paragraph',
          parent: 't',
          data: { text: [{ text: 'Cell value' }] },
        },
      ],
    };
    const out = normalizeForParity(doc, new Set(['t']));

    expect(out.blocks[0]?.data.content).toEqual([[{ blocks: ['b0.0'] }]]);
    expect(out).toEqual({
      blocks: [
        {
          id: 't',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [[{ blocks: ['b0.0'] }]],
          },
          content: ['b0.0'],
        },
        {
          id: 'b0.0',
          type: 'paragraph',
          parent: 't',
          data: { text: [{ text: 'Cell value' }] },
        },
      ],
    });
  });

  it('drops tool-minted table cell ids without removing ordinary data ids', () => {
    const doc: OutputData = {
      blocks: [{
        id: 't',
        type: 'table',
        data: {
          id: 'domain-id',
          content: [[{ id: 'cell-auto', rowId: 'row-auto', blocks: [] }]],
        },
      }],
    };

    expect(normalizeForParity(doc, new Set(['t'])).blocks[0]?.data).toEqual({
      id: 'domain-id',
      content: [[{ blocks: [] }]],
    });
  });

  it('preserves roots without ids and counts their structural positions', () => {
    const doc: OutputData = {
      blocks: [
        { type: 'paragraph', data: { text: '<b>First</b>' } },
        { id: 'minted', type: 'paragraph', data: { text: 'Second' } },
      ],
    };
    const normalize = (): ReturnType<typeof normalizeForParity> => normalizeForParity(doc, new Set());

    expect(normalize).not.toThrow();
    expect(normalize()).toEqual({
      blocks: [
        { type: 'paragraph', data: { text: [{ text: 'First', marks: { bold: true } }] } },
        { id: 'b1', type: 'paragraph', data: { text: [{ text: 'Second' }] } },
      ],
    });
  });

  it('compares editor-created output with JSON insertion without a creation-time mismatch', () => {
    const manager = new YjsManager({
      config: {},
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    });

    try {
      manager.addBlockAt({
        id: 'p1', type: 'paragraph', data: { text: [{ text: 'New' }] },
      }, { parentId: null, afterId: null });
      const json = DocSnapshot.fromOutput({ blocks: [] });

      applyEdits(json, [{
        op: 'insert',
        parentId: null,
        afterId: null,
        block: {
          id: 'p1', type: 'paragraph', data: { text: [{ text: 'New' }] }, children: [],
        },
      }], null);
      const editorOutput: OutputData = { blocks: manager.toJSON() };
      const jsonOutput = json.toOutput();
      const keepIds = new Set(['p1']);

      expect(normalizeForParity(editorOutput, keepIds)).toEqual(normalizeForParity(jsonOutput, keepIds));
      expect(typeof editorOutput.blocks[0]?.createdAt).toBe('number');
      expect(jsonOutput.blocks[0]).not.toHaveProperty('createdAt');
    } finally {
      manager.destroy();
    }
  });

  it('keeps creation and last-edit authorship distinct in parity comparisons', () => {
    const doc: OutputData = {
      blocks: [{
        id: 'p1',
        type: 'paragraph',
        data: { text: [{ text: 'New' }] },
        createdAt: 1,
        createdBy: 'human-1',
        lastEditedAt: 2,
        lastEditedBy: 'agent-1',
      }],
    };
    const keepIds = new Set(['p1']);
    const normalized = normalizeForParity(doc, keepIds);

    expect(normalized.blocks[0]).toMatchObject({
      createdBy: 'human-1',
      lastEditedBy: 'agent-1',
    });
    expect(normalized).not.toEqual(normalizeForParity({
      ...doc,
      blocks: doc.blocks.map(block => ({ ...block, createdBy: 'human-2' })),
    }, keepIds));
    expect(normalized).not.toEqual(normalizeForParity({
      ...doc,
      blocks: doc.blocks.map(block => ({ ...block, lastEditedBy: 'agent-2' })),
    }, keepIds));
  });

  it('sorts object keys recursively without changing array order or values', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(stableStringify({ z: [{ b: false, a: null }, 'second'], a: 'first' }))
      .toBe('{"a":"first","z":[{"a":null,"b":false},"second"]}');
  });
});
