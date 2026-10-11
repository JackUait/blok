import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { DatabasePermissionAction } from '../../../../src/tools/database/types';
import { buildTool, commitCell, fakeRow, makeDoc } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const gate = (denied: DatabasePermissionAction[]): { can: Mock<(action: DatabasePermissionAction, ctx: { databaseId: string }) => boolean> } => ({
  can: vi.fn((action: DatabasePermissionAction) => !denied.includes(action)),
});

describe('DatabaseTool — config.permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('without editContent the database is read-only: no add row, no title edit, no value write', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', notes: 'old' }, 'a0')]);
    const permissions = gate(['editContent']);
    const { tool, el } = buildTool(doc, { permissions });

    expect(el.querySelector('[data-blok-database-table-add-row]')).toBeNull();
    expect(el.querySelector('[data-blok-database-title]')?.getAttribute('contenteditable')).not.toBe('true');
    commitCell(tool, 'a', 'notes', 'new');
    expect(doc.rows.get('a')?.data.properties.notes).toBe('old');
    expect(permissions.can).toHaveBeenCalledWith('editContent', { databaseId: 'db' });
  });

  it('without editStructure rows stay editable but properties, views and the title do not', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', notes: 'old' }, 'a0')]);
    const { tool, el } = buildTool(doc, { permissions: gate(['editStructure']) });

    expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();
    tool.addView('board');
    tool.renameView('v', 'Renamed');
    expect(tool.save(el).views.map((view) => view.name)).toEqual(['View']);
    expect(el.querySelector('[data-blok-database-title]')?.getAttribute('contenteditable')).not.toBe('true');
    expect(el.querySelector('[data-blok-database-table-add-row]')).not.toBeNull();
    commitCell(tool, 'a', 'notes', 'new');
    expect(doc.rows.get('a')?.data.properties.notes).toBe('new');
  });

  it('without editStructure a CSV merge adds nothing, as on a locked database', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const { tool } = buildTool(doc, { permissions: gate(['editStructure']) });

    tool.mergeCsv('Name\nBravo\n');

    expect(doc.order).toEqual(['a']);
  });

  it('a gate that throws denies, so a broken host never opens writes', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const { el } = buildTool(doc, { permissions: { can: () => { throw new Error('offline'); } } });

    expect(el.querySelector('[data-blok-database-table-add-row]')).toBeNull();
  });

  it('setReadOnly(false) reads the gate again, so a host can open writes later', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const denied: DatabasePermissionAction[] = ['editContent'];
    const { tool, el } = buildTool(doc, { permissions: { can: (action) => !denied.includes(action) } }, undefined, true);

    denied.length = 0;
    tool.setReadOnly(false);

    expect(el.querySelector('[data-blok-database-table-add-row]')).not.toBeNull();
  });
});
