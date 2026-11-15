import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addNote, createNotesDocument, readNotesCollection, rememberNotesCollection } from './notes-collection';
import type { AgentResult } from '../../types/agent';
import type { WorkspaceRef } from './workspace-registry';

const workspace: WorkspaceRef = { kind: 'local', id: 'notes-test', name: 'Test' };
const success: AgentResult = { ok: true, warnings: [], revision: '1', results: [{ rowId: 'note-1' }], refs: {}, changed: { created: ['note-1'], updated: [], moved: [], removed: [] } };
function editor(result: AgentResult = success) {
  const call = vi.fn();
  const end = vi.fn();
  const execute = vi.fn(async () => result);
  return { isReady: Promise.resolve(), agent: { begin: vi.fn(() => ({ execute, end })) }, blocks: { getById: vi.fn(() => ({ name: 'database', call })) }, call, end, execute };
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });
describe('Notes collection', () => {
  it('seeds only a native database with created time and table/list layouts, without fabricated rows', () => {
    const document = createNotesDocument('db');
    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]).toMatchObject({ id: 'db', type: 'database', data: { fullPage: true, schema: [{ type: 'title' }, { type: 'createdTime' }], views: [{ type: 'table' }, { type: 'list' }] } });
  });
  it('keeps collection identity across renames and isolated by workspace and remote account', () => {
    rememberNotesCollection(workspace, { pageId: 'page', databaseId: 'db' });
    expect(readNotesCollection({ ...workspace, name: 'Renamed' })).toEqual({ pageId: 'page', databaseId: 'db' });
    expect(readNotesCollection({ ...workspace, id: 'other' })).toBeNull();
    const remote: WorkspaceRef = { kind: 'remote', id: 'r', name: 'Remote', server: 'https://example.com', accountId: 'a', workspaceId: 'w' };
    rememberNotesCollection(remote, { pageId: 'private', databaseId: 'db' });
    expect(readNotesCollection({ ...remote, accountId: 'b' })).toBeNull();
  });
  it('adds through native row defaults and opens the returned row as a full page', async () => {
    const host = editor();
    expect(await addNote(host, 'db')).toBe('note-1');
    expect(host.execute).toHaveBeenCalledExactlyOnceWith({ commands: [{ name: 'database.addRow', args: { id: 'db' } }] });
    expect(host.call).toHaveBeenCalledExactlyOnceWith('openRow', { rowId: 'note-1', mode: 'full', explicit: true });
    expect(host.end).toHaveBeenCalledOnce();
  });
  it('does not add to a missing or replaced database', async () => {
    const host = editor(); host.blocks.getById.mockReturnValue({ name: 'paragraph', call: host.call });
    await expect(addNote(host, 'db')).rejects.toThrow('introuvable');
    expect(host.agent.begin).not.toHaveBeenCalled();
  });
  it('does not write after navigation or open a row when navigation occurs during creation', async () => {
    const host = editor();
    await expect(addNote(host, 'db', () => false)).rejects.toThrow('changé');
    expect(host.execute).not.toHaveBeenCalled();
    const current = { value: true };
    host.execute.mockImplementation(async () => { current.value = false; return success; });
    expect(await addNote(host, 'db', () => current.value)).toBe('note-1');
    expect(host.call).not.toHaveBeenCalled();
    expect(host.end).toHaveBeenCalledOnce();
  });
  it('ends a refused command without opening a fabricated row', async () => {
    const host = editor({ ok: false, warnings: [], error: { code: 'READ_ONLY', message: 'Écriture refusée', retryable: false } });
    await expect(addNote(host, 'db')).rejects.toThrow('Écriture refusée');
    expect(host.end).toHaveBeenCalledOnce(); expect(host.call).not.toHaveBeenCalled();
  });
});
