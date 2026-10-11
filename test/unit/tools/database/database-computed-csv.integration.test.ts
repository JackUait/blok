import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { parseCsv } from '../../../../src/tools/database/database-csv';
import type { DatabaseConfig, PropertyDefinition } from '../../../../src/tools/database/types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy(): void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

describe('computed CSV values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('exports rollup option labels, people names and file URLs', async () => {
    const schema: PropertyDefinition[] = [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'related', name: 'Related', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', twoWay: true } },
      { id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a2', config: { options: [{ id: 'red', label: 'Red label', position: 'a0' }] } },
      { id: 'people', name: 'People', type: 'person', position: 'a3' },
      { id: 'files', name: 'Files', type: 'files', position: 'a4' },
      ...['tags', 'people', 'files'].map((id, index): PropertyDefinition => ({
        id: 'roll-' + id, name: 'Roll ' + id, type: 'rollup', position: 'a' + (index + 5),
        rollup: { relationPropertyId: 'related', targetPropertyId: id, function: 'show_original' },
      })),
    ];
    const config: DatabaseConfig = { people: { list: async () => [{ id: 'sam', name: 'Sam' }] } };

    let database: DatabaseTool | undefined;

    class ConfiguredDatabase extends DatabaseTool {
      constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
        super({ ...options, config });
        database = this;
      }
    }

    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { database: ConfiguredDatabase, 'database-row': DatabaseRowTool },
      data: { blocks: [
        { id: 'db', type: 'database', content: ['r1', 'r2'], data: {
          schema,
          views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [],
            properties: schema.map(p => ({ id: p.id, visible: p.id === 't' || p.id.startsWith('roll-') })) }],
          activeViewId: 'v',
        } },
        { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { t: 'Source', related: [{ id: 'r2' }] } } },
        { id: 'r2', type: 'database-row', parent: 'db', data: { position: 'a1', properties: {
          t: 'Target', tags: ['red'], people: [{ id: 'sam' }],
          files: [{ id: 'image', name: 'image.png', url: 'https://example.test/image.png' }],
        } } },
      ] },
    }) as unknown as TestEditor;
    await editor.isReady;
    await new Promise(resolve => setTimeout(resolve, 0));
    if (database === undefined) throw new Error('no database tool');
    const csv = database.exportCsv();
    expect(parseCsv(csv)[1]).toEqual(['Source', 'Red label', 'Sam', 'https://example.test/image.png']);
  });
});
