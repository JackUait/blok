import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA, buildTool, makeDoc, tableData } from './tier3-harness';
import type { DatabaseTool } from '../../../../src/tools/database';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const built: DatabaseTool[] = [];

const selfRelation: PropertyDefinition = { id: 'rel', name: 'Related', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db' } };

const build = (data: DatabaseData, doc = makeDoc([])): { tool: DatabaseTool; el: HTMLElement } => {
  const result = buildTool(doc, {}, data);

  built.push(result.tool);

  return result;
};

const mirrorOf = (tool: DatabaseTool, el: HTMLElement): PropertyDefinition | undefined =>
  tool.save(el).schema.find((p) => p.relation?.syncedPropertyId === 'rel');

/** A second database block, "other", with a title property and whatever the test adds. */
const otherDatabase = (schema: PropertyDefinition[]) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const block = {
    id: 'other',
    name: 'database',
    call: vi.fn((method: string, param: Record<string, unknown>) => {
      calls.push([method, param]);
      if (method === 'readRelationSource') (param.receive as (source: unknown) => void)({ databaseId: 'other', schema, rows: [] });
      if (method === 'addSyncedRelation') (param.receive as (id: string) => void)('mirror');
    }),
  };

  return { block, calls };
};

describe('DatabaseTool — the name of a two-way relation\'s mirror (notion-spec-2 §17.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('two-way on with a name gives the mirror that name', () => {
    const { tool, el } = build(tableData([...SCHEMA, selfRelation]));

    tool.setRelationTwoWay('rel', true, undefined, 'Parents');

    expect(mirrorOf(tool, el)?.name).toBe('Parents');
  });

  it('a name another property has gets the next free one', () => {
    const { tool, el } = build(tableData([...SCHEMA, selfRelation]));

    tool.setRelationTwoWay('rel', true, undefined, 'Notes');

    expect(mirrorOf(tool, el)?.name).toBe('Notes 1');
  });

  it('reads the name a new mirror would get, then the mirror\'s own', () => {
    const { tool } = build(tableData([...SCHEMA, selfRelation]));

    expect(tool.relationMirrorName('rel')).toBe('tools.database.relationReverseName');
    tool.setRelationTwoWay('rel', true, undefined, 'Parents');
    expect(tool.relationMirrorName('rel')).toBe('Parents');
  });

  it('renames the mirror of a self-relation', () => {
    const { tool, el } = build(tableData([...SCHEMA, selfRelation]));

    tool.setRelationTwoWay('rel', true, undefined, 'Parents');
    tool.renameRelationMirror('rel', 'Children');

    expect(mirrorOf(tool, el)?.name).toBe('Children');
  });

  it('asks the related database to rename its mirror', () => {
    const doc = makeDoc([]);
    const other = otherDatabase([
      { id: 'o-title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'mirror', name: 'Old', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'rel' } },
    ]);

    vi.mocked(doc.api.blocks.getById).mockImplementation(((id: string) => (id === 'other' ? other.block : null)) as never);
    const { tool } = build(tableData([...SCHEMA, { ...selfRelation, relation: { targetDatabaseId: 'other', twoWay: true, syncedPropertyId: 'mirror' } }]), doc);

    expect(tool.relationMirrorName('rel')).toBe('Old');
    tool.renameRelationMirror('rel', 'Owners');

    expect(other.calls).toContainEqual(['renameMirrorProperty', { propertyId: 'mirror', name: 'Owners' }]);
  });

  it('names a new mirror in the related database, clear of the names there', () => {
    const doc = makeDoc([]);
    const other = otherDatabase([{ id: 'o-title', name: 'Owners', type: 'title', position: 'a0' }]);

    vi.mocked(doc.api.blocks.getById).mockImplementation(((id: string) => (id === 'other' ? other.block : null)) as never);
    const { tool } = build(tableData([...SCHEMA, { ...selfRelation, relation: { targetDatabaseId: 'other' } }]), doc);

    tool.setRelationTwoWay('rel', true, undefined, 'Owners');

    expect(other.calls.find(([method]) => method === 'addSyncedRelation')?.[1]).toMatchObject({ name: 'Owners 1' });
  });

  it('renameMirrorProperty renames a property of this database', () => {
    const { tool, el } = build(tableData([...SCHEMA, selfRelation]));

    tool.renameMirrorProperty({ propertyId: 'rel', name: 'Linked' });

    expect(tool.save(el).schema.find((p) => p.id === 'rel')?.name).toBe('Linked');
  });
});
