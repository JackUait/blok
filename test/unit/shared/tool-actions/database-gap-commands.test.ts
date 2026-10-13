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

type Option = { id: string; label: string; color?: string; position: string };
type Property = Record<string, unknown> & { id: string; name: string; type: string; position: string; config?: { options: Option[] }; defaultTemplateId?: string };

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

const rowData = (doc: FakeDoc, rowId: string): Record<string, unknown> & { properties: Record<string, unknown> } =>
  doc.get(rowId)?.data as Record<string, unknown> & { properties: Record<string, unknown> };

const lock = (doc: FakeDoc, id: string, schema: Property[]): void =>
  createFakeCtx(doc, id).update(id, { schema: schema.map((property, i) => (i === 0 ? { ...property, databaseLocked: true } : property)) });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('database.updateProperty', () => {
  it('renames and changes settings; null removes a setting, as the editor\'s updateProperty does', () => {
    const { doc, id, schema, data } = make();
    const status = schema()[1].id;

    run(doc, id, 'updateProperty', { propertyId: status, name: '  Stage  ', settings: { description: 'Where it is', icon: '🚦' } });
    expect(schema()[1]).toMatchObject({ name: 'Stage', description: 'Where it is', icon: '🚦' });
    run(doc, id, 'updateProperty', { propertyId: status, settings: { icon: null } });
    expect(schema()[1]).not.toHaveProperty('icon');
    expect(schema()[1].description).toBe('Where it is');
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });

  it('refuses an empty name, an unknown property and a locked database', () => {
    const { doc, id, schema } = make();

    expect(() => run(doc, id, 'updateProperty', { propertyId: schema()[1].id, name: ' ' })).toThrow(FakeFailure);
    expect(() => run(doc, id, 'updateProperty', { propertyId: 'nope', name: 'x' })).toThrow(/no property nope/);
    lock(doc, id, schema());
    expect(() => run(doc, id, 'updateProperty', { propertyId: schema()[1].id, name: 'x' })).toThrow(/locked/);
  });
});

describe('database.duplicateProperty / deleteProperty', () => {
  it('copies a property right after the original, with every row value', () => {
    const { doc, id, schema } = make();
    const status = schema()[1];
    const option = status.config?.options[0]?.id;
    const { rowId } = run(doc, id, 'addRow', { values: { [status.id]: option } }) as { rowId: string };
    const { templateId } = run(doc, id, 'addTemplate', {}) as { templateId: string };

    run(doc, id, 'setRowValues', { rowId: templateId, values: { [status.id]: option } });
    const { propertyId } = run(doc, id, 'duplicateProperty', { propertyId: status.id }) as { propertyId: string };
    const copy = schema().find(property => property.id === propertyId);

    expect(copy).toMatchObject({ name: 'Status (copy)', type: 'select', config: status.config });
    expect((copy?.position ?? '') > status.position).toBe(true);
    expect(rowData(doc, rowId).properties[propertyId]).toBe(option);
    // Templates are not rows: the editor copies values over its rows only.
    expect(rowData(doc, templateId).properties).not.toHaveProperty(propertyId);
  });

  it('refuses to duplicate or delete the title', () => {
    const { doc, id, schema } = make();

    expect(() => run(doc, id, 'duplicateProperty', { propertyId: schema()[0].id })).toThrow(FakeFailure);
    expect(() => run(doc, id, 'deleteProperty', { propertyId: schema()[0].id })).toThrow(FakeFailure);
  });

  it('deletes a property from the schema and keeps row values, as the editor does (D9)', () => {
    const { doc, id, schema } = make();
    const status = schema()[1];
    const option = status.config?.options[0]?.id;
    const { rowId } = run(doc, id, 'addRow', { values: { [status.id]: option } }) as { rowId: string };

    run(doc, id, 'deleteProperty', { propertyId: status.id });

    expect(schema().map(property => property.id)).not.toContain(status.id);
    expect(rowData(doc, rowId).properties[status.id]).toBe(option);
  });
});

describe('database.recolorOption', () => {
  it('sets an option color by id', () => {
    const { doc, id, schema } = make();
    const status = schema()[1];
    const optionId = status.config?.options[0]?.id;

    run(doc, id, 'recolorOption', { propertyId: status.id, optionId, color: 'purple' });

    expect(schema()[1].config?.options[0]?.color).toBe('purple');
    expect(() => run(doc, id, 'recolorOption', { propertyId: status.id, optionId: 'nope', color: 'red' })).toThrow(/no option nope/);
  });
});

describe('database templates', () => {
  it('adds an empty template after the last one, not among the rows', () => {
    const { doc, id, schema } = make();
    const first = (run(doc, id, 'addTemplate', {}) as { templateId: string }).templateId;
    const second = (run(doc, id, 'addTemplate', {}) as { templateId: string }).templateId;

    expect(doc.get(first)).toMatchObject({ type: 'database-row', parentId: id, data: { properties: { [schema()[0].id]: '' }, title: '', template: true } });
    expect(String(rowData(doc, second).position) > String(rowData(doc, first).position)).toBe(true);
    expect(validateAgainst(DATABASE_ROW_DATA, rowData(doc, first))).toEqual([]);
  });

  it('templates do not take part in row order, option deletes or list seeding', () => {
    const { doc, id, schema } = make();
    const status = schema()[1];
    const option = status.config?.options[0]?.id;
    const { templateId } = run(doc, id, 'addTemplate', {}) as { templateId: string };

    run(doc, id, 'setRowValues', { rowId: templateId, values: { [status.id]: option } });
    run(doc, id, 'deleteOption', { propertyId: status.id, optionId: option, rows: 'delete' });
    expect(doc.has(templateId)).toBe(true);
    const { propertyId } = run(doc, id, 'addProperty', { name: 'Owner', type: 'person' }) as { propertyId: string };

    expect(rowData(doc, templateId).properties).not.toHaveProperty(propertyId);
  });

  it('sets and clears the default template, which must be a template of this database', () => {
    const { doc, id, schema } = make();
    const { templateId } = run(doc, id, 'addTemplate', {}) as { templateId: string };
    const { rowId } = run(doc, id, 'addRow', {}) as { rowId: string };

    run(doc, id, 'setDefaultTemplate', { templateId });
    expect(schema()[0].defaultTemplateId).toBe(templateId);
    run(doc, id, 'setDefaultTemplate', { templateId: null });
    expect(schema()[0]).not.toHaveProperty('defaultTemplateId');
    expect(() => run(doc, id, 'setDefaultTemplate', { templateId: rowId })).toThrow(/not a template/);
  });

  it('sets and clears a template repeat schedule', () => {
    const { doc, id } = make();
    const { templateId } = run(doc, id, 'addTemplate', {}) as { templateId: string };
    const { rowId } = run(doc, id, 'addRow', {}) as { rowId: string };
    const repeat = { frequency: 'weekly', interval: 2, start: '2026-10-13T09:00:00.000Z' };

    run(doc, id, 'setTemplateRepeat', { templateId, repeat });
    expect(rowData(doc, templateId).repeat).toEqual(repeat);
    expect(validateAgainst(DATABASE_ROW_DATA, rowData(doc, templateId))).toEqual([]);
    run(doc, id, 'setTemplateRepeat', { templateId, repeat: null });
    expect(rowData(doc, templateId)).not.toHaveProperty('repeat');
    expect(() => run(doc, id, 'setTemplateRepeat', { templateId: rowId, repeat })).toThrow(/not a template/);
  });
});

describe('gap command declarations', () => {
  it.each([
    'database.updateProperty', 'database.duplicateProperty', 'database.deleteProperty', 'database.recolorOption',
    'database.addTemplate', 'database.setDefaultTemplate', 'database.setTemplateRepeat', 'database.changePropertyType',
  ])('%s is a database action', command => {
    expect(describeDatabase().actions?.map(action => `database.${action.name}`)).toContain(command);
  });

  const argsOf = (name: string): Record<string, unknown> => describeDatabase().actions?.find(action => action.name === name)?.args ?? {};

  it('validates the arguments and wires every handler', () => {
    expect(validateAgainst(argsOf('updateProperty'), { propertyId: 'p', name: 'N', settings: { icon: null, description: 'd' } })).toEqual([]);
    expect(validateAgainst(argsOf('updateProperty'), { propertyId: 'p', settings: { type: 'text' } }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('recolorOption'), { propertyId: 'p', optionId: 'o', color: 'teal' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('setDefaultTemplate'), { templateId: null })).toEqual([]);
    expect(validateAgainst(argsOf('setTemplateRepeat'), { templateId: 't', repeat: { frequency: 'daily', start: 'x' } })).toEqual([]);
    expect(validateAgainst(argsOf('setTemplateRepeat'), { templateId: 't', repeat: { frequency: 'hourly', start: 'x' } }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('addTemplate'), {})).toEqual([]);
    for (const name of ['updateProperty', 'duplicateProperty', 'deleteProperty', 'recolorOption', 'setDefaultTemplate', 'setTemplateRepeat', 'addTemplate']) {
      expect(BUILT_IN_TOOL_RUNTIMES.get('database')?.actions[name], name).toBe(handler(name));
    }
  });
});
