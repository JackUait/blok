import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../types';

const FILE = resolve(__dirname, 'fixtures/agent-moves.json');
const SEED: OutputBlockData[] = [
  { id: 'a', type: 'toggle', data: {}, content: ['a1', 'a2'] },
  { id: 'a1', type: 'paragraph', data: {}, parent: 'a' },
  { id: 'a2', type: 'paragraph', data: {}, parent: 'a' },
  { id: 'b', type: 'paragraph', data: {} },
];
const CASES = [
  { name: 'root-into-parent-first', id: 'b', parent: 'a', after: null },
  { name: 'child-to-root-after', id: 'a1', parent: null, after: 'b' },
  { name: 'reorder-siblings', id: 'a1', parent: 'a', after: 'a2' },
  { name: 'root-reorder-first', id: 'b', parent: null, after: null },
];

/** C# Move must give the same export as DocumentStore.moveBlockTo. */
describe('agent move lockstep fixture', () => {
  it('matches DocumentStore.moveBlockTo', () => {
    const out = CASES.map((c) => {
      const store = new DocumentStore(new YBlockSerializer());

      store.fromJSON(SEED);
      store.moveBlockTo(c.id, { parentId: c.parent, afterId: c.after });

      return { ...c, expected: store.toJSON() };
    });
    const fixture = { seed: SEED, cases: out };

    if (process.env.UPDATE_AGENT_GOLDENS === '1') {
      writeFileSync(FILE, `${JSON.stringify(fixture, null, 2)}\n`);
    }

    expect(JSON.parse(readFileSync(FILE, 'utf-8'))).toEqual(fixture);
  });
});
