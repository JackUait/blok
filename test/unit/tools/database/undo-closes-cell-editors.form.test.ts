import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PropertyDefinition } from '../../../../src/tools/database/types';
import { buildTool, fakeRow, makeDoc, tableData } from './tier3-harness';

/** A form answer is no row value: an undo of the database must not drop it. */

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
  { id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a2', config: { options: [{ id: 't1', label: 'Red', position: 'a0' }] } },
];

const tools: Array<ReturnType<typeof buildTool>['tool']> = [];

const mount = (view: Record<string, unknown>): ReturnType<typeof buildTool> & { emitUndo: () => void } => {
  const doc = makeDoc([fakeRow('r1', 'db', { title: 'One', s: 'o1' }, 'a0')]);
  const result = buildTool(doc, {}, tableData(schema, { visibleProperties: ['s'], ...view }));

  tools.push(result.tool);

  return {
    ...result,
    emitUndo: () => doc.api.events.emit('block replayed', {
      blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
      native: { type: 'database-row', parent: { present: true, value: 'db' }, template: { present: false } },
      changes: [],
    }),
  };
};

const openEditors = (): number => document.querySelectorAll('[data-blok-database-cell-editor]').length;

describe('undo and the form view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tools.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('closes a board card editor (the replay reaches the hook)', () => {
    const { el, emitUndo } = mount({ type: 'board', groupBy: 's' });

    el.querySelector('[data-blok-database-card][data-row-id="r1"] [data-blok-database-card-property][data-property-id="s"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditors()).toBe(1);

    emitUndo();

    expect(openEditors()).toBe(0);
  });

  it('keeps a form question editor open', () => {
    const { el, emitUndo } = mount({ type: 'form', properties: [{ id: 'tags', visible: true, showOptionsAs: 'dropdown' }] });

    el.querySelector('[data-blok-database-form-provider-answer]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditors()).toBe(1);

    emitUndo();

    expect(openEditors()).toBe(1);
  });
});
