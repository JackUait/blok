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

  it('drops a table initialColWidth measured from a real browser layout', () => {
    const doc: OutputData = {
      blocks: [{ id: 't', type: 'table', data: { withHeadings: true, initialColWidth: 233, content: [[{ blocks: [] }]] } }],
    };

    expect(normalizeForParity(doc, new Set(['t'])).blocks[0]?.data).toEqual({
      withHeadings: true,
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

  it('compares whether a block carries its timestamps, not their values', () => {
    const stamped = (createdAt: number, lastEditedAt: number): OutputData => ({
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'New' }] }, createdAt, lastEditedAt }],
    });
    const keepIds = new Set(['p1']);
    const bare = normalizeForParity({ blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'New' }] } }] }, keepIds);

    expect(normalizeForParity(stamped(1, 2), keepIds)).toEqual(normalizeForParity(stamped(30, 40), keepIds));
    expect(normalizeForParity(stamped(1, 2), keepIds)).not.toEqual(bare);
    expect(bare.blocks[0]).not.toHaveProperty('createdAt');
    expect(bare.blocks[0]).not.toHaveProperty('lastEditedAt');
  });

  it('sees an editor-created block whose JSON twin has no creation time', () => {
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
      const keepIds = new Set(['p1']);

      expect(normalizeForParity({ blocks: manager.toJSON() }, keepIds)).not.toEqual(normalizeForParity(json.toOutput(), keepIds));
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

  it('preserves colliding payload strings while relabeling only structural references', () => {
    const doc: OutputData = {
      blocks: [
        {
          id: 'table-minted',
          type: 'table',
          data: { content: [[{ blocks: ['minted'], text: 'minted' }]] },
          content: ['minted'],
        },
        {
          id: 'minted',
          type: 'minted',
          parent: 'table-minted',
          data: {
            text: [{ text: 'minted' }],
            url: 'minted',
            id: 'minted',
            parent: 'minted',
            content: ['minted'],
            blocks: ['minted'],
          },
          tunes: { label: 'minted', metadata: { id: 'minted' } },
          createdBy: 'minted',
          lastEditedBy: 'minted',
        },
      ],
    };
    const out = normalizeForParity(doc, new Set<string>());

    expect(out.blocks[1]?.data.text).toEqual([{ text: 'minted' }]);
    expect(out).toEqual({
      blocks: [
        {
          id: 'b0',
          type: 'table',
          data: { content: [[{ blocks: ['b0.0'], text: 'minted' }]] },
          content: ['b0.0'],
        },
        {
          id: 'b0.0',
          type: 'minted',
          parent: 'b0',
          data: {
            text: [{ text: 'minted' }],
            url: 'minted',
            id: 'minted',
            parent: 'minted',
            content: ['minted'],
            blocks: ['minted'],
          },
          tunes: { label: 'minted', metadata: { id: 'minted' } },
          createdBy: 'minted',
          lastEditedBy: 'minted',
        },
      ],
    });
  });

  it('retains an orphan block whose parent is missing', () => {
    const doc: OutputData = {
      blocks: [
        { id: 'root', type: 'paragraph', data: { text: [{ text: 'Root' }] } },
        {
          id: 'orphan', type: 'paragraph', parent: 'missing-parent',
          data: { text: [{ text: 'Orphan' }] },
        },
      ],
    };
    const out = normalizeForParity(doc, new Set(['root', 'orphan']));

    expect(out.blocks).toHaveLength(2);
    expect(out).toEqual({
      blocks: [
        { id: 'root', type: 'paragraph', data: { text: [{ text: 'Root' }] } },
        {
          id: 'orphan', type: 'paragraph', parent: 'missing-parent',
          data: { text: [{ text: 'Orphan' }] },
        },
      ],
    });
  });

  it('retains an unlisted child when its parent also lists another child', () => {
    const doc: OutputData = {
      blocks: [
        {
          id: 'parent', type: 'toggle', content: ['listed'],
          data: { text: [{ text: 'Parent' }] },
        },
        {
          id: 'listed', type: 'paragraph', parent: 'parent',
          data: { text: [{ text: 'Listed' }] },
        },
        {
          id: 'unlisted', type: 'paragraph', parent: 'parent',
          data: { text: [{ text: 'Extra block' }] },
        },
      ],
    };
    const out = normalizeForParity(doc, new Set(['parent', 'listed', 'unlisted']));

    expect(out.blocks).toHaveLength(3);
    expect(out).toEqual({
      blocks: [
        {
          id: 'parent', type: 'toggle', content: ['listed'],
          data: { text: [{ text: 'Parent' }] },
        },
        {
          id: 'listed', type: 'paragraph', parent: 'parent',
          data: { text: [{ text: 'Listed' }] },
        },
        {
          id: 'unlisted', type: 'paragraph', parent: 'parent',
          data: { text: [{ text: 'Extra block' }] },
        },
      ],
    });
  });

  it('sorts object keys recursively without changing array order or values', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(stableStringify({ z: [{ b: false, a: null }, 'second'], a: 'first' }))
      .toBe('{"a":"first","z":[{"a":null,"b":false},"second"]}');
  });
});
