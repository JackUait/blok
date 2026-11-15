import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { extractPageOutline } from './page-outline';
import { workspaceRepository } from './workspace-repository';

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it('extracts actual database blocks only, preserving block identities and owner', () => {
  expect(extractPageOutline('page', { blocks: [
    { id: 'db', type: 'database', data: { title: 'Tasks' } },
    { id: 'p', type: 'paragraph', data: { text: 'Database' } },
    { id: 'row', type: 'database-row', parentId: 'db', data: { title: 'Task' } },
    { id: 'untitled', type: 'database', data: {} },
    { type: 'database', data: { title: 'No identity' } },
  ] })).toEqual([
    { blockId: 'db', pageId: 'page', title: 'Tasks', type: 'database' },
    { blockId: 'untitled', pageId: 'page', title: 'Base de données', type: 'database' },
  ]);
  expect(extractPageOutline('page', null)).toEqual([]);
});
it('loads only the requested remote page through authenticated read-only transport', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ blocks: [{ id: 'db', type: 'database', data: { title: 'Tasks' } }] })));
  vi.stubGlobal('fetch', fetcher);
  const repository = workspaceRepository({ kind: 'remote', id: 'remote', name: 'Team', accountId: 'alice', server: 'https://example.test', workspaceId: 'team' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await repository.readPageOutline('page/id')).toEqual([{ blockId: 'db', pageId: 'page/id', title: 'Tasks', type: 'database' }]);
  expect(fetcher).toHaveBeenCalledWith('https://example.test/api/workspaces/team/pages/page%2Fid', expect.objectContaining({ credentials: 'include' }));
  expect(() => repository.readPage('page/id')).toThrow('Remote documents require collaboration');
});
it('propagates revoked access without cached descriptors or content fallback', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  const repository = workspaceRepository({ kind: 'remote', id: 'remote', name: 'Team', accountId: 'alice', server: 'https://example.test', workspaceId: 'team' });
  await expect(repository.readPageOutline('private')).rejects.toThrow('404');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('discovers local databases after queued page writes without a network request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const repository = workspaceRepository({ kind: 'local', id: 'outline-test', name: 'Local' });
  const writing = repository.writePage('page', JSON.stringify({ blocks: [{ id: 'db', type: 'database', data: { title: 'Local notes' } }] }));
  expect(await repository.readPageOutline('page')).toEqual([{ blockId: 'db', pageId: 'page', title: 'Local notes', type: 'database' }]);
  await writing;
  expect(fetcher).not.toHaveBeenCalled();
});
