import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData, DatabaseSavedAutomation as DraftDefinition, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildTool, fakeRow, makeDoc, tableData } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();
    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }
    destroy(): void {}
  },
}));

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'signal', name: 'Signal', type: 'text', position: 'a2' },
  { id: 'result', name: 'Result', type: 'text', position: 'a3' },
];

const definition = (
  triggers: DraftDefinition['triggers'],
  triggerMode: DraftDefinition['triggerMode'] = 'any'
): DraftDefinition => ({
  id: 'auto-1',
  name: 'Mark eligible row',
  status: 'active',
  scope: { type: 'database' },
  triggerMode,
  triggers,
  actions: [{ id: 'action-1', type: 'editProperty', target: 'triggerRow', propertyId: 'result', value: 'ran' }],
});

const dataWith = (draft: DraftDefinition): DatabaseData => ({
  ...tableData(schema),
  automations: { version: 1, definitions: [draft] },
});

const editText = (root: HTMLElement, rowId: string, propertyId: string, value: string): void => {
  const cell = root.querySelector<HTMLElement>(
    '[data-row-id="' + rowId + '"] [role="gridcell"][data-property-id="' + propertyId + '"]'
  );
  if (cell === null) throw new Error('missing editable cell');
  cell.click();
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input]');
  if (input === null) throw new Error('missing cell editor');
  input.value = value;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};

describe('DatabaseTool — saved native automation definitions', () => {
  const tools: Array<ReturnType<typeof buildTool>['tool']> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    tools.forEach((tool) => tool.destroy());
    tools.length = 0;
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('runs a saved Page added action without an onTrigger callback', async () => {
    const doc = makeDoc([]);
    const draft = definition([{ id: 'trigger-1', type: 'pageAdded' }]);
    const { tool, el } = buildTool(doc, {}, dataWith(draft));
    tools.push(tool);
    const button = el.querySelector<HTMLElement>('[data-blok-database-table-add-row]');
    if (button === null) throw new Error('missing Add row button');
    button.click();
    await vi.advanceTimersByTimeAsync(500);
    const rowId = doc.order[0];

    expect(doc.rows.get(rowId)?.data.properties.result).toBe('ran');
    expect(tool.save(el).automations).toEqual({ version: 1, definitions: [draft] });
    expect(doc.rows.get(rowId)?.dispatchChange).toHaveBeenCalledWith({ derived: true });
  });

  it('stores an emptied person value as an empty list, like a cell edit', async () => {
    const people: PropertyDefinition = { id: 'owner', name: 'Owner', type: 'person', position: 'a4' };
    const doc = makeDoc([]);
    const draft: DraftDefinition = {
      ...definition([{ id: 'trigger-1', type: 'pageAdded' }]),
      actions: [{ id: 'action-1', type: 'editProperty', target: 'triggerRow', propertyId: 'owner', value: null }],
    };
    const { tool, el } = buildTool(doc, {}, {
      ...tableData([...schema, people]),
      automations: { version: 1, definitions: [draft] },
    });
    tools.push(tool);
    const button = el.querySelector<HTMLElement>('[data-blok-database-table-add-row]');
    if (button === null) throw new Error('missing Add row button');
    button.click();
    await vi.advanceTimersByTimeAsync(500);

    expect(doc.rows.get(doc.order[0])?.data.properties.owner).toEqual([]);
  });

  it('runs a saved Property edited action from a real cell commit', async () => {
    const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', notes: 'before' }, 'a0')]);
    const draft = definition([{ id: 'trigger-1', type: 'propertyEdited', propertyId: 'notes' }]);
    const { tool, el } = buildTool(doc, {}, dataWith(draft));
    tools.push(tool);
    editText(el, 'r1', 'notes', 'after');
    await vi.advanceTimersByTimeAsync(500);

    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');
    expect(doc.rows.get('r1')?.data.properties.notes).toBe('after');
  });

  it('combines two is-edited conditions 2900ms apart despite the 500ms settle delay', async () => {
    const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', notes: 'before', signal: 'before' }, 'a0')]);
    const draft = definition([
      { id: 'trigger-notes', type: 'propertyEdited', propertyId: 'notes' },
      { id: 'trigger-signal', type: 'propertyEdited', propertyId: 'signal' },
    ], 'all');
    const { tool, el } = buildTool(doc, {}, dataWith(draft));
    tools.push(tool);
    editText(el, 'r1', 'notes', 'first');
    await vi.advanceTimersByTimeAsync(2900);
    editText(el, 'r1', 'signal', 'second');
    await vi.advanceTimersByTimeAsync(500);

    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');
  });

  it('does not combine edits 3100ms apart, but runs for a fresh complete window', async () => {
    const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', notes: 'before', signal: 'before' }, 'a0')]);
    const draft = definition([
      { id: 'trigger-notes', type: 'propertyEdited', propertyId: 'notes' },
      { id: 'trigger-signal', type: 'propertyEdited', propertyId: 'signal' },
    ], 'all');
    const { tool, el } = buildTool(doc, {}, dataWith(draft));
    tools.push(tool);
    editText(el, 'r1', 'notes', 'old');
    await vi.advanceTimersByTimeAsync(3100);
    editText(el, 'r1', 'signal', 'new');
    await vi.advanceTimersByTimeAsync(500);

    expect(doc.rows.get('r1')?.data.properties.result).toBeUndefined();

    editText(el, 'r1', 'notes', 'fresh');
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');
  });

  it('cancels a pending native trigger when its replacement edit has no saved definitions', async () => {
    const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', notes: 'before' }, 'a0')]);
    const draft = definition([{ id: 'trigger-notes', type: 'propertyEdited', propertyId: 'notes' }]);
    const data = dataWith(draft);
    const { tool, el } = buildTool(doc, {}, data);
    tools.push(tool);
    editText(el, 'r1', 'notes', 'old pending edit');
    await vi.advanceTimersByTimeAsync(250);
    tool.setData(tableData(schema));
    editText(el, 'r1', 'notes', 'replacement without definitions');
    tool.setData(data);
    await vi.advanceTimersByTimeAsync(250);

    expect(doc.rows.get('r1')?.data.properties.result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBeUndefined();

    editText(el, 'r1', 'notes', 'fresh eligible edit');
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');
    expect(doc.rows.get('r1')?.data.properties.notes).toBe('fresh eligible edit');
  });

  it('rechecks the saved scoped view at firing and reads definitions replaced through setData', async () => {
    const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', notes: 'before' }, 'a0')]);
    const draft = definition([{ id: 'trigger-1', type: 'propertyEdited', propertyId: 'notes' }]);
    draft.scope = { type: 'view', viewId: 'v' };
    const data = dataWith(draft);
    const { tool, el } = buildTool(doc, {}, data);
    tools.push(tool);
    editText(el, 'r1', 'notes', 'go');
    await vi.advanceTimersByTimeAsync(250);
    tool.setData({
      ...data,
      views: data.views.map((view) => ({
        ...view,
        filters: [{ propertyId: 'notes', operator: 'equals', value: 'not-go' }],
      })),
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(doc.rows.get('r1')?.data.properties.result).toBeUndefined();

    tool.setData(data);
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBeUndefined();
    editText(el, 'r1', 'notes', 'eligible fresh edit');
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');
  });

  it('keeps the 500ms host observation without chaining a native result write', async () => {
    const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', notes: 'before' }, 'a0')]);
    const onTrigger = vi.fn();
    const first = definition([{ id: 'trigger-notes', type: 'propertyEdited', propertyId: 'notes' }]);
    const second: DraftDefinition = {
      ...definition([{ id: 'trigger-result', type: 'propertyEdited', propertyId: 'result' }]),
      id: 'auto-2',
      actions: [{ id: 'action-2', type: 'editProperty', target: 'triggerRow', propertyId: 'signal', value: 'chained' }],
    };
    const { tool, el } = buildTool(doc, { automations: { onTrigger } }, {
      ...dataWith(first),
      automations: { version: 1, definitions: [first, second] },
    });
    tools.push(tool);
    editText(el, 'r1', 'notes', 'after');
    await vi.advanceTimersByTimeAsync(499);
    expect(onTrigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.signal).toBeUndefined();
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith(
      { type: 'propertyEdited', rowId: 'r1', propertyId: 'notes', value: 'after' },
      expect.anything()
    );
  });

  it('keeps the existing firing-time lock gate for saved native actions', async () => {
    const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', notes: 'before' }, 'a0')]);
    const draft = definition([{ id: 'trigger-notes', type: 'propertyEdited', propertyId: 'notes' }]);
    const data = dataWith(draft);
    const { tool, el } = buildTool(doc, {}, data);
    tools.push(tool);
    editText(el, 'r1', 'notes', 'first');
    await vi.advanceTimersByTimeAsync(500);

    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');

    editText(el, 'r1', 'result', '');
    editText(el, 'r1', 'notes', 'pending');
    await vi.advanceTimersByTimeAsync(250);
    tool.setData({
      ...data,
      schema: data.schema.map((property) => property.type === 'title'
        ? { ...property, databaseLocked: true }
        : property),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(doc.rows.get('r1')?.data.properties.result).toBe('');
    tool.setData(data);
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBe('');
    editText(el, 'r1', 'notes', 'after unlock');
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');
  });

  it('reads paused and reactivated definitions from current setData', async () => {
    const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', notes: 'before' }, 'a0')]);
    const draft = definition([{ id: 'trigger-notes', type: 'propertyEdited', propertyId: 'notes' }]);
    draft.status = 'paused';
    const { tool, el } = buildTool(doc, {}, dataWith(draft));
    tools.push(tool);
    editText(el, 'r1', 'notes', 'while paused');
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBeUndefined();
    tool.setData(dataWith({ ...draft, status: 'active' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(doc.rows.get('r1')?.data.properties.result).toBeUndefined();
    editText(el, 'r1', 'notes', 'after resume');
    await vi.advanceTimersByTimeAsync(500);

    expect(doc.rows.get('r1')?.data.properties.result).toBe('ran');
  });
});
