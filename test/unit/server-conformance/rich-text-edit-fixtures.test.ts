// @vitest-environment node

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { planRichTextEdit } from '../../../src/components/modules/yjs/rich-text-write';
import { deltaToSegments, segmentsToDeltaOps, type ReadDeltaOp } from '../../../src/shared/rich-text/delta';
import { canonicalizeSegments } from '../../../src/shared/rich-text/html-to-segments';
import type { RichText, RichTextEmbed } from '../../../types/rich-text';

/**
 * The shared rich-text edit fixtures (see fixtures/rich-text-edits/README.md).
 * This test replays each case's ops in REAL yjs and pins what they leave, so
 * the ops are checked independently of the C# planner that wrote them. The
 * C# suite (RichTextEditFixtureTests) asserts its planner emits these ops and
 * its engine leaves this delta; the client planner must emit them too.
 * `UPDATE_RICH_TEXT_FIXTURES=1` rewrites each case's `expected`.
 */
const FILE = fileURLToPath(new URL('./fixtures/rich-text-edits/cases.json', import.meta.url));

type Attributes = Record<string, unknown>;

type EditOp =
  | { op: 'insert'; index: number; text: string; attributes: Attributes }
  | { op: 'insertEmbed'; index: number; embed: RichTextEmbed; attributes: Attributes }
  | { op: 'delete'; index: number; length: number }
  | { op: 'format'; index: number; length: number; attributes: Attributes };

interface EditCase {
  name: string;
  description: string;
  current: RichText;
  next: RichText;
  ops: EditOp[];
  expected: { writes: boolean; segments: RichText; delta: ReadDeltaOp[] };
}

const cases = JSON.parse(readFileSync(FILE, 'utf8')) as EditCase[];

const seeded = (current: RichText): { doc: Y.Doc; text: Y.XmlText } => {
  const doc = new Y.Doc();
  const text = new Y.XmlText();

  doc.transact(() => {
    doc.getMap('blocks').set('b1', text);

    let index = 0;

    for (const op of segmentsToDeltaOps(current)) {
      if (typeof op.insert === 'string') {
        text.insert(index, op.insert, op.attributes);
        index += op.insert.length;
      } else {
        text.insertEmbed(index, op.insert, op.attributes);
        index += 1;
      }
    }
  });

  return { doc, text };
};

const apply = (text: Y.XmlText, op: EditOp): void => {
  switch (op.op) {
    case 'insert':
      text.insert(op.index, op.text, op.attributes);
      break;
    case 'insertEmbed':
      text.insertEmbed(op.index, op.embed, op.attributes);
      break;
    case 'delete':
      text.delete(op.index, op.length);
      break;
    case 'format':
      text.format(op.index, op.length, op.attributes);
      break;
  }
};

const replay = (entry: EditCase): { updates: number; delta: ReadDeltaOp[] } => {
  const { doc, text } = seeded(entry.current);
  let updates = 0;

  doc.on('update', () => {
    updates += 1;
  });

  // A clone: yjs's insert writes null into the attributes object it is
  // handed for every mark in force that the object does not name.
  const ops = structuredClone(entry.ops);

  if (ops.length > 0) {
    doc.transact(() => ops.forEach(op => apply(text, op)));
  }

  return { updates, delta: text.toDelta() as ReadDeltaOp[] };
};

const results = cases.map(entry => ({ entry, ...replay(entry) }));

if (process.env.UPDATE_RICH_TEXT_FIXTURES === '1') {
  const updated = results.map(({ entry, delta }) => ({
    ...entry,
    expected: { writes: entry.ops.length > 0, segments: deltaToSegments(delta), delta },
  }));

  writeFileSync(FILE, `${JSON.stringify(updated, null, 2)}\n`);
}

describe('rich-text edit fixtures', () => {
  it('has unique case names', () => {
    expect(new Set(cases.map(entry => entry.name)).size).toBe(cases.length);
  });

  it.each(results.map(result => [result.entry.name, result] as const))('%s', (_name, { entry, updates, delta }) => {
    // No ops exactly when nothing changed: that is the no-write rule.
    expect(entry.ops.length === 0).toBe(
      JSON.stringify(deltaToSegments(seeded(entry.current).text.toDelta() as ReadDeltaOp[])) ===
      JSON.stringify(canonicalizeSegments(entry.next))
    );
    expect(updates).toBe(entry.expected.writes ? 1 : 0);
    expect(JSON.stringify(deltaToSegments(delta))).toBe(JSON.stringify(canonicalizeSegments(entry.next)));
    expect(JSON.stringify(deltaToSegments(delta))).toBe(JSON.stringify(entry.expected.segments));
    expect(JSON.stringify(delta)).toBe(JSON.stringify(entry.expected.delta));
  });

  // The client planner (document-store.ts `updateBlockData` runs it; the
  // store-level replay is rich-text-write-path.test.ts).
  it.each(cases.map(entry => [entry.name, entry] as const))('the client plans exactly the ops: %s', (_name, entry) => {
    const live = seeded(entry.current).text.toDelta() as ReadDeltaOp[];

    expect(planRichTextEdit(live, canonicalizeSegments(entry.next))).toEqual(entry.ops);
  });
});
