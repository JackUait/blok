// @vitest-environment node

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { canonicalizeSegments } from '../../../../src/shared/rich-text/html-to-segments';
import {
  deltaToSegments,
  normalizeMarkValue,
  segmentsToDeltaOps,
  type DeltaOp,
  type ReadDeltaOp,
} from '../../../../src/shared/rich-text/delta';
import type { RichText } from '../../../../types/rich-text';
import { CANONICAL } from './corpus';

const NUL = String.fromCharCode(0);

/** Writes ops the way the Yjs contract says: running index, explicit attributes. */
const writeOps = (text: Y.XmlText, ops: DeltaOp[]): void => {
  let index = 0;

  for (const op of ops) {
    if (typeof op.insert === 'string') {
      text.insert(index, op.insert, op.attributes);
      index += op.insert.length;
    } else {
      text.insertEmbed(index, op.insert, op.attributes);
      index += 1;
    }
  }
};

const readDelta = (text: Y.XmlText): ReadDeltaOp[] => text.toDelta() as ReadDeltaOp[];

const EXTRA: RichText[] = [
  [{ text: '😀 bold', marks: { bold: true } }, { text: ' 👨‍👩‍👧 plain' }, { text: 'é', marks: { italic: true } }],
  [{ text: 'run', marks: { bold: true } }, { text: 'after' }],
  [{ embed: { equation: { expression: 'x' } }, marks: { bold: true } }, { text: 'tail', marks: { bold: true } }],
  [{ text: 'x', marks: { 'tag:span': { 'data-a': '1', class: 'c' } } }],
];

const ALL = [...CANONICAL, ...EXTRA];
const cases = ALL.map(rich => [JSON.stringify(rich), rich] as const);

describe('segmentsToDeltaOps / deltaToSegments', () => {
  it.each(cases)('round trips to the same canonical bytes: %s', (_label, rich) => {
    expect(JSON.stringify(deltaToSegments(segmentsToDeltaOps(rich)))).toBe(JSON.stringify(canonicalizeSegments(rich)));
  });

  it.each(cases)('round trips through a real integrated Y.XmlText: %s', (_label, rich) => {
    const doc = new Y.Doc();
    const text = doc.get('t', Y.XmlText);

    writeOps(text, segmentsToDeltaOps(rich));

    expect(JSON.stringify(deltaToSegments(readDelta(text)))).toBe(JSON.stringify(canonicalizeSegments(rich)));
  });

  it.each(cases)('round trips through a prelim Y.XmlText set into a Y.Map: %s', (_label, rich) => {
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const text = new Y.XmlText();

    writeOps(text, segmentsToDeltaOps(rich));
    map.set('text', text);

    const stored = map.get('text');

    expect(stored).toBeInstanceOf(Y.XmlText);
    expect(JSON.stringify(deltaToSegments(readDelta(stored as Y.XmlText)))).toBe(JSON.stringify(canonicalizeSegments(rich)));
  });

  it('gives every op an explicit attributes object, {} when unmarked', () => {
    expect(segmentsToDeltaOps([{ text: 'a', marks: { bold: true } }, { text: 'b' }])).toStrictEqual([
      { insert: 'a', attributes: { bold: true } },
      { insert: 'b', attributes: {} },
    ]);
  });

  it('maps an embed to its object with the segment marks as attributes', () => {
    expect(segmentsToDeltaOps([{ embed: { page: { id: 'p1' } }, marks: { italic: true } }])).toStrictEqual([
      { insert: { page: { id: 'p1' } }, attributes: { italic: true } },
    ]);
  });

  it('never writes a mark that is off', () => {
    const rich = [{ text: 'a', marks: { bold: false, italic: true } }] as unknown as RichText;

    expect(segmentsToDeltaOps(rich)).toStrictEqual([{ insert: 'a', attributes: { italic: true } }]);
  });

  it('reads ops with no attributes and with {} alike, never emitting empty marks', () => {
    expect(deltaToSegments([{ insert: 'a' }, { insert: 'b', attributes: {} }])).toStrictEqual([{ text: 'ab' }]);
  });

  it('writes link attributes normalised: undefined members dropped, keys sorted', () => {
    const [op] = segmentsToDeltaOps([{ text: 'a', marks: { link: { href: 'h', target: undefined, rel: 'r' } } }]);

    expect(JSON.stringify(op.attributes)).toBe('{"link":{"href":"h","rel":"r"}}');
  });
});

describe('normalizeMarkValue', () => {
  it('treats { href, target: undefined } as equal to { href }', () => {
    expect(JSON.stringify(normalizeMarkValue({ href: 'h', target: undefined }))).toBe(JSON.stringify(normalizeMarkValue({ href: 'h' })));
    expect(normalizeMarkValue({ href: 'h', target: undefined })).toStrictEqual({ href: 'h' });
  });

  it('sorts keys at every depth', () => {
    expect(JSON.stringify(normalizeMarkValue({ b: { d: 1, c: 2 }, a: 1 }))).toBe('{"a":1,"b":{"c":2,"d":1}}');
  });

  it('scrubs NUL from keys and string values', () => {
    expect(normalizeMarkValue({ [`ti${NUL}tle`]: `t${NUL}x`, nested: { k: `${NUL}v` } })).toStrictEqual({ nested: { k: 'v' }, title: 'tx' });
    expect(normalizeMarkValue(`a${NUL}b`)).toBe('ab');
  });

  it('keeps scalars as they are', () => {
    expect(normalizeMarkValue(true)).toBe(true);
    expect(normalizeMarkValue('red')).toBe('red');
  });
});
