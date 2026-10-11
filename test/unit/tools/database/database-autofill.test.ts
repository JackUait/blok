import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseAutofillRequest, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { buildTool, commitCell, fakeRow, makeDoc, tableData } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const schema = (autofill: PropertyDefinition['autofill']): PropertyDefinition[] => [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'summary', name: 'Summary', type: 'text', position: 'a2', autofill },
];

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('DatabaseTool — config.ai.autofill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('fills an onCreate property of a new row and writes it as a host value', async () => {
    const doc = makeDoc([]);
    const autofill = vi.fn((_request: DatabaseAutofillRequest): Promise<PropertyValue> => Promise.resolve('A short summary'));
    const { el } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'summary', onCreate: true })));

    el.querySelector<HTMLElement>('[data-blok-database-table-add-row]')?.click();
    await settle();

    const rowId = doc.order[0];

    expect(autofill).toHaveBeenCalledWith(expect.objectContaining({ databaseId: 'db', rowId, propertyId: 'summary', settings: { mode: 'summary', onCreate: true } }));
    expect(doc.rows.get(rowId)?.data.properties.summary).toBe('A short summary');
    expect(doc.rows.get(rowId)?.dispatchChange).toHaveBeenLastCalledWith({ derived: true });
  });

  it('fills an onEdit property again once another value settles, and its own write asks nothing more', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const autofill = vi.fn((): Promise<PropertyValue> => Promise.resolve('Updated'));
    const { tool } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'keyInfo', onEdit: true })));

    commitCell(tool, 'a', 'notes', 'n');
    commitCell(tool, 'a', 'notes', 'ne');
    await vi.advanceTimersByTimeAsync(600);

    expect(autofill).toHaveBeenCalledTimes(1);
    expect(doc.rows.get('a')?.data.properties.summary).toBe('Updated');
    await vi.advanceTimersByTimeAsync(600);
    expect(autofill).toHaveBeenCalledTimes(1);
  });

  it('drops a stale answer when a person changed the value while the host worked', async () => {
    const doc = makeDoc([]);
    let answer: (value: PropertyValue) => void = () => undefined;
    const autofill = vi.fn(() => new Promise<PropertyValue>((resolve) => {
      answer = resolve;
    }));
    const { tool, el } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'custom', instruction: 'x', onCreate: true })));

    el.querySelector<HTMLElement>('[data-blok-database-table-add-row]')?.click();
    const rowId = doc.order[0];

    await settle();
    expect(autofill).toHaveBeenCalledTimes(1);
    commitCell(tool, rowId, 'summary', 'Mine');
    answer('From the host');
    await settle();

    expect(doc.rows.get(rowId)?.data.properties.summary).toBe('Mine');
  });

  it('an answer that lands while the new row\'s title is being typed keeps the editor open', async () => {
    const doc = makeDoc([]);
    let answer: (value: PropertyValue) => void = () => undefined;
    const autofill = vi.fn(() => new Promise<PropertyValue>((resolve) => {
      answer = resolve;
    }));
    const { el } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'summary', onCreate: true })));

    el.querySelector<HTMLElement>('[data-blok-database-table-add-row]')?.click();
    await settle();
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-editor] [data-blok-database-cell-input]');

    expect(field).not.toBeNull();
    field?.focus();
    if (field !== null) field.value = 'Half typ';
    answer('Summary');
    await settle();

    expect(field?.isConnected).toBe(true);
    expect(field?.value).toBe('Half typ');
    expect(doc.rows.get(doc.order[0])?.data.properties.summary).toBe('Summary');
  });

  it('asks nothing for a property without an autofill setting', async () => {
    const doc = makeDoc([]);
    const autofill = vi.fn((): Promise<PropertyValue> => Promise.resolve('x'));
    const { el } = buildTool(doc, { ai: { autofill } }, tableData(schema(undefined)));

    el.querySelector<HTMLElement>('[data-blok-database-table-add-row]')?.click();
    await settle();

    expect(autofill).not.toHaveBeenCalled();
  });
});
