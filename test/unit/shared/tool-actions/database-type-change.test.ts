// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { DATABASE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/database';
import { DATABASE_DATA, describeDatabase } from '../../../../src/shared/tool-descriptions/database';
import { DATABASE_ROW_DATA } from '../../../../src/shared/tool-descriptions/database-row';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeDoc } from './fake-ctx';

type Option = { id: string; label: string };
type Property = Record<string, unknown> & { id: string; name: string; type: string; config?: { options: Option[] }; relation?: unknown };
type Row = { properties: Record<string, unknown>; convertedValues?: Record<string, { type: string; value: unknown }> };

const handler = (name: string): ToolActionImpl => {
  const found = DATABASE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing database handler "${name}".`);
  }

  return found;
};

const make = (): { doc: FakeDoc; id: string; schema: () => Property[]; data: () => Record<string, unknown> } => {
  const seed = createFakeCtx(docOf([]), undefined, 'database');
  const { id } = handler('create').run(seed, {}, undefined) as { id: string };
  const data = (): Record<string, unknown> => {
    const value = seed.read(id)?.data;

    return typeof value === 'object' && value !== null ? { ...value } : {};
  };

  return { doc: seed.doc, id, data, schema: (): Property[] => data().schema as Property[] };
};

const run = (doc: FakeDoc, id: string, name: string, args: Record<string, unknown>): unknown =>
  handler(name).run(createFakeCtx(doc, id), args, undefined);

const rowOf = (doc: FakeDoc, rowId: string): Row => doc.get(rowId)?.data as Row;

const addText = (doc: FakeDoc, id: string, name = 'Notes'): string =>
  (run(doc, id, 'addProperty', { name, type: 'text' }) as { propertyId: string }).propertyId;

const addRow = (doc: FakeDoc, id: string, values: Record<string, unknown>): string =>
  (run(doc, id, 'addRow', { values }) as { rowId: string }).rowId;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('database.changePropertyType', () => {
  it('text to select makes one option per distinct label and writes their ids', () => {
    const { doc, id, schema, data } = make();
    const notes = addText(doc, id);
    const a = addRow(doc, id, { [notes]: 'High' });
    const b = addRow(doc, id, { [notes]: 'high' });
    const c = addRow(doc, id, { [notes]: 'Low' });

    run(doc, id, 'changePropertyType', { propertyId: notes, type: 'select' });
    const property = schema().find(candidate => candidate.id === notes);
    const options = property?.config?.options ?? [];

    expect(property?.type).toBe('select');
    expect(options.map(option => option.label)).toEqual(['High', 'Low']);
    expect([a, b, c].map(rowId => rowOf(doc, rowId).properties[notes])).toEqual([options[0]?.id, options[0]?.id, options[1]?.id]);
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });

  it('keeps what the new type cannot hold, and a change back restores it', () => {
    const { doc, id } = make();
    const notes = addText(doc, id);
    const rowId = addRow(doc, id, { [notes]: 'about ten' });

    run(doc, id, 'changePropertyType', { propertyId: notes, type: 'number' });
    expect(rowOf(doc, rowId).properties[notes]).toBeNull();
    expect(rowOf(doc, rowId).convertedValues).toEqual({ [notes]: { type: 'text', value: 'about ten' } });
    expect(validateAgainst(DATABASE_ROW_DATA, rowOf(doc, rowId))).toEqual([]);

    run(doc, id, 'changePropertyType', { propertyId: notes, type: 'text' });
    expect(rowOf(doc, rowId).properties[notes]).toBe('about ten');
    expect(rowOf(doc, rowId)).not.toHaveProperty('convertedValues');
  });

  it('a new relation points at this database, and list types are never left unset', () => {
    const { doc, id, schema } = make();
    const notes = addText(doc, id);
    const rowId = addRow(doc, id, {});

    run(doc, id, 'changePropertyType', { propertyId: notes, type: 'relation' });

    expect(schema().find(candidate => candidate.id === notes)?.relation).toEqual({ targetDatabaseId: id });
    expect(rowOf(doc, rowId).properties[notes]).toEqual([]);
  });

  it('templates are not converted', () => {
    const { doc, id } = make();
    const notes = addText(doc, id);
    const { templateId } = run(doc, id, 'addTemplate', {}) as { templateId: string };

    run(doc, id, 'setRowValues', { rowId: templateId, values: { [notes]: 'High' } });
    run(doc, id, 'changePropertyType', { propertyId: notes, type: 'select' });

    expect(rowOf(doc, templateId).properties[notes]).toBe('High');
  });

  it.each([
    ['the title', (p: Property[]) => p[0]?.id, 'text', /title/],
    ['the same type', (p: Property[]) => p[1]?.id, 'select', /already/],
  ] as const)('refuses %s', (_label, pick, type, message) => {
    const { doc, id, schema } = make();

    expect(() => run(doc, id, 'changePropertyType', { propertyId: pick(schema()), type })).toThrow(message);
  });

  it('refuses a locked database', () => {
    const { doc, id, schema } = make();
    const notes = addText(doc, id);

    createFakeCtx(doc, id).update(id, { schema: schema().map((property, i) => (i === 0 ? { ...property, databaseLocked: true } : property)) });

    expect(() => run(doc, id, 'changePropertyType', { propertyId: notes, type: 'number' })).toThrow(/locked/);
  });

  it.each(['createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'uniqueId'])('refuses %s as the source: its values exist only in the editor', from => {
    const { doc, id } = make();
    const { propertyId } = run(doc, id, 'addProperty', { name: 'Meta', type: from }) as { propertyId: string };

    expect(() => run(doc, id, 'changePropertyType', { propertyId, type: 'text' })).toThrow(FakeFailure);
  });

  it('refuses a rich text property that still holds legacy HTML, and writes nothing', () => {
    const { doc, id } = make();
    const { propertyId } = run(doc, id, 'addProperty', { name: 'Body', type: 'richText' }) as { propertyId: string };
    const ctx = createFakeCtx(doc, id);

    addRow(doc, id, { [propertyId]: { blocks: [{ id: 'p', type: 'paragraph', data: { text: '<b>Hi</b>' } }] } });

    expect(() => handler('changePropertyType').run(ctx, { propertyId, type: 'text' }, undefined)).toThrow(/HTML/);
    expect(ctx.edits).toEqual([]);
  });

  it('converts current rich text segments without a browser', () => {
    const { doc, id } = make();
    const { propertyId } = run(doc, id, 'addProperty', { name: 'Body', type: 'richText' }) as { propertyId: string };
    const rowId = addRow(doc, id, { [propertyId]: { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hi' }] } }] } });

    run(doc, id, 'changePropertyType', { propertyId, type: 'text' });

    expect(rowOf(doc, rowId).properties[propertyId]).toBe('Hi');
  });

  it('is declared with the convertible types, mirrors the type menu and is wired', () => {
    const action = describeDatabase().actions?.find(candidate => candidate.name === 'changePropertyType');

    expect(action?.mirrors).toEqual(['menu:database/type-*']);
    expect(validateAgainst(action?.args ?? {}, { propertyId: 'p', type: 'select' })).toEqual([]);
    expect(validateAgainst(action?.args ?? {}, { propertyId: 'p', type: 'title' }).length).toBeGreaterThan(0);
    expect(validateAgainst(action?.args ?? {}, { propertyId: 'p', type: 'formula' }).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('database')?.actions.changePropertyType).toBe(handler('changePropertyType'));
  });
});
