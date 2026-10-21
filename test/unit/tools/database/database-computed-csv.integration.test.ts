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
    });
    await editor.isReady;
    await new Promise(resolve => setTimeout(resolve, 0));
    if (database === undefined) throw new Error('no database tool');
    const csv = database.exportCsv();
    expect(parseCsv(csv)[1]).toEqual(['Source', 'Red label', 'Sam', 'https://example.test/image.png']);
  });

  it('shows and exports a mixed formula\'s person branch by name once the people directory loads', async () => {
    const schema: PropertyDefinition[] = [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'owner', name: 'Owner', type: 'person', position: 'a1' },
      { id: 'who', name: 'Who', type: 'formula', position: 'a2', formula: { expression: 'if(empty({{property:owner}}), "Nobody", {{property:owner}})' } },
    ];
    const directory: { resolve?: (people: Array<{ id: string; name: string }>) => void } = {};
    const config: DatabaseConfig = { people: { list: () => new Promise((resolve) => { directory.resolve = resolve; }) } };

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
            properties: schema.map(p => ({ id: p.id, visible: p.id !== 'owner' })) }],
          activeViewId: 'v',
        } },
        { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { t: 'One', owner: [{ id: 'sam' }] } } },
        { id: 'r2', type: 'database-row', parent: 'db', data: { position: 'a1', properties: { t: 'Two' } } },
      ] },
    });
    await editor.isReady;
    for (const _ of [0, 1, 2]) await new Promise(resolve => setTimeout(resolve, 0));
    const cell = (): string | undefined => holder?.querySelector('[data-row-id="r1"] [data-blok-database-table-cell][data-property-id="who"]')?.textContent?.trim();

    expect(cell()).toBe('sam');
    directory.resolve?.([{ id: 'sam', name: 'Sam' }]);
    for (const _ of [0, 1, 2]) await new Promise(resolve => setTimeout(resolve, 0));
    if (database === undefined) throw new Error('no database tool');

    expect(cell()).toBe('Sam');
    database.openFormulaEditor('who', null);
    expect(document.querySelector('[data-blok-database-formula-preview]')?.textContent).toBe('Sam');
    expect(parseCsv(database.exportCsv()).slice(1)).toEqual([['One', 'Sam'], ['Two', 'Nobody']]);
  });
});
