import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseTool } from '../../../../src/tools/database';
import type { AutofillSettings, DatabaseAutofillRequest, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
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

  it('Only specific properties: an edit of another property fills nothing', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const autofill = vi.fn((): Promise<PropertyValue> => Promise.resolve('Updated'));
    const { tool } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'keyInfo', onEdit: true, onEditProperties: ['notes'] })));

    commitCell(tool, 'a', 'title', 'Renamed');
    await vi.advanceTimersByTimeAsync(600);
    expect(autofill).not.toHaveBeenCalled();
    commitCell(tool, 'a', 'notes', 'n');
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

  it('a manual run racing a fill on edit: the answer that lands second never overwrites the first', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const answers: Array<(value: PropertyValue) => void> = [];
    const autofill = vi.fn(() => new Promise<PropertyValue>((resolve) => {
      answers.push(resolve);
    }));
    const { tool } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'summary', onEdit: true })));
    const run = document.querySelector<HTMLElement>('[data-row-id="a"] [data-property-id="summary"] [data-blok-database-table-autofill]');

    expect(run).not.toBeNull();
    run?.click();
    commitCell(tool, 'a', 'notes', 'n');
    await vi.advanceTimersByTimeAsync(600);
    expect(autofill).toHaveBeenCalledTimes(2);
    answers[1]('Automatic');
    await vi.advanceTimersByTimeAsync(0);
    answers[0]('Manual');
    await vi.advanceTimersByTimeAsync(0);

    expect(doc.rows.get('a')?.data.properties.summary).toBe('Automatic');
    expect(document.querySelector('[data-row-id="a"] [data-blok-database-table-autofill-thinking]')).toBeNull();
  });

  it('two fills of one cell: the later request wins even when the earlier one answers last', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const answers: Array<(value: PropertyValue) => void> = [];
    const autofill = vi.fn(() => new Promise<PropertyValue>((resolve) => {
      answers.push(resolve);
    }));
    const { tool } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'summary', onEdit: true })));

    commitCell(tool, 'a', 'notes', 'n');
    await vi.advanceTimersByTimeAsync(600);
    commitCell(tool, 'a', 'notes', 'ne');
    await vi.advanceTimersByTimeAsync(600);
    expect(autofill).toHaveBeenCalledTimes(2);
    answers[0]('From the old notes');
    await vi.advanceTimersByTimeAsync(0);
    answers[1]('From the new notes');
    await vi.advanceTimersByTimeAsync(0);

    expect(doc.rows.get('a')?.data.properties.summary).toBe('From the new notes');
    expect(document.querySelector('[data-row-id="a"] [data-blok-database-table-autofill-thinking]')).toBeNull();
  });

  it('a host autofill that throws at once ends Thinking… and offers Autofill again', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const autofill = vi.fn((): Promise<PropertyValue> => {
      throw new Error('No AI');
    });

    buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'summary' })));
    const run = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-row-id="a"] [data-property-id="summary"] [data-blok-database-table-autofill]');

    expect(() => run()?.click()).not.toThrow();

    expect(autofill).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-row-id="a"] [data-blok-database-table-autofill-thinking]')).toBeNull();
    expect(run()).not.toBeNull();
  });

  it('a newer fill that throws at once leaves the running one to land', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    let answer: (value: PropertyValue) => void = () => undefined;
    const autofill = vi.fn()
      .mockImplementationOnce(() => new Promise<PropertyValue>((resolve) => {
        answer = resolve;
      }))
      .mockImplementationOnce(() => {
        throw new Error('No AI');
      });
    const { tool } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'summary', onEdit: true })));

    commitCell(tool, 'a', 'notes', 'n');
    await vi.advanceTimersByTimeAsync(600);
    commitCell(tool, 'a', 'notes', 'ne');
    await vi.advanceTimersByTimeAsync(600);
    expect(autofill).toHaveBeenCalledTimes(2);
    answer('From the running fill');
    await vi.advanceTimersByTimeAsync(0);

    expect(doc.rows.get('a')?.data.properties.summary).toBe('From the running fill');
  });

  it('a fill running when its AI Autofill is deleted writes nothing', async () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    let answer: (value: PropertyValue) => void = () => undefined;
    const autofill = vi.fn(() => new Promise<PropertyValue>((resolve) => {
      answer = resolve;
    }));
    const { tool } = buildTool(doc, { ai: { autofill } }, tableData(schema({ mode: 'summary' })));

    document.querySelector<HTMLElement>('[data-row-id="a"] [data-property-id="summary"] [data-blok-database-table-autofill]')?.click();
    expect(autofill).toHaveBeenCalledTimes(1);
    tool.updatePropertySettings('summary', { autofill: undefined });
    answer('Too late');
    await settle();

    expect(doc.rows.get('a')?.data.properties.summary).toBeUndefined();
  });

  it('Generate on a property with no saved AI Autofill still writes its answer', async () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const autofill = vi.fn((): Promise<PropertyValue> => Promise.resolve('Generated'));
    const { tool } = buildTool(doc, { ai: { autofill } }, tableData(schema(undefined)));

    (tool as unknown as { runAutofill: (id: string, settings: AutofillSettings) => void }).runAutofill('summary', { mode: 'summary' });
    await settle();

    expect(doc.rows.get('a')?.data.properties.summary).toBe('Generated');
  });

  describe('deleting a property that Only specific properties watches', () => {
    const watching = (ids: string[]): PropertyDefinition[] => [
      { id: 'title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
      { id: 'tags', name: 'Tags', type: 'text', position: 'a2' },
      { id: 'summary', name: 'Summary', type: 'text', position: 'a3', autofill: { mode: 'summary', onCreate: true, onEdit: true, onEditProperties: ids } },
    ];
    const build = (ids: string[]): { tool: DatabaseTool; dispatchChange: ReturnType<typeof vi.fn> } => {
      const dispatchChange = vi.fn();
      const tool = new DatabaseTool({ data: tableData(watching(ids)), config: { ai: { autofill: vi.fn() } }, api: makeDoc([]).api, readOnly: false, block: { id: 'db', dispatchChange } as never });

      document.body.appendChild(tool.render());
      tool.rendered();

      return { tool, dispatchChange };
    };
    const summaryAutofill = (tool: DatabaseTool): PropertyDefinition['autofill'] => tool.save(document.createElement('div')).schema.find((property) => property.id === 'summary')?.autofill;

    it('drops the deleted id and keeps the rest, in the delete\'s one write', () => {
      const { tool, dispatchChange } = build(['notes', 'tags']);

      dispatchChange.mockClear();
      tool.deleteProperty('notes');

      expect(summaryAutofill(tool)).toEqual({ mode: 'summary', onCreate: true, onEdit: true, onEditProperties: ['tags'] });
      expect(dispatchChange).toHaveBeenCalledTimes(1);
    });

    it('with none left, the trigger falls back to None, as unticking the last box does', () => {
      const { tool, dispatchChange } = build(['notes']);

      dispatchChange.mockClear();
      tool.deleteProperty('notes');

      expect(summaryAutofill(tool)).toEqual({ mode: 'summary', onCreate: true });
      expect(dispatchChange).toHaveBeenCalledTimes(1);
    });
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
