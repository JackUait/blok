// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { readPageFields, writePageField } from '../../../src/components/modules/yjs/page-fields';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';

const FILE = resolve(__dirname, 'fixtures/agent-page-fields.json');
const STEPS = [
  { key: 'title', value: 'Plan' },
  { key: 'icon', value: { type: 'emoji', value: '🚀' } },
  { key: 'title', value: '' },
  { key: 'icon', value: null },
] as const;

/** C# SetPageField must leave the page map as page-fields.ts does after each step. */
describe('agent page-field lockstep fixture', () => {
  it('matches page-fields.ts', () => {
    const store = new DocumentStore(new YBlockSerializer());
    const after = STEPS.map((step) => {
      store.transact(() => writePageField(store.page, step.key, step.value), 'local');

      return readPageFields(store.page);
    });
    const fixture = { steps: STEPS, after };

    if (process.env.UPDATE_AGENT_GOLDENS === '1') {
      writeFileSync(FILE, `${JSON.stringify(fixture, null, 2)}\n`);
    }

    expect(JSON.parse(readFileSync(FILE, 'utf-8'))).toEqual(fixture);
  });
});
