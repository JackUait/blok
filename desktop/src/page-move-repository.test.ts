import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workspaceRepository } from './workspace-repository';
import type { RemoteWorkspace } from './workspace-registry';
const remote: RemoteWorkspace = { kind: 'remote', id: 'r', name: 'Équipe', server: 'https://example.org', accountId: 'a', workspaceId: 'equipe', role: 'member' };
beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('uses the dedicated move endpoint and refreshes its revision before later metadata saves', async () => {
  const pages = [{ id: 'source', title: 'Source', parentId: null }, { id: 'target', title: 'Target', parentId: null }];
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ pages, revision: 1 }))
    .mockResolvedValueOnce(Response.json({ id: 'source', parentId: 'target', revision: 2 }))
    .mockResolvedValueOnce(Response.json({ pages: [{ ...pages[0], parentId: 'target' }, pages[1]], revision: 2 }))
    .mockResolvedValueOnce(Response.json({ revision: 3 }));
  vi.stubGlobal('fetch', fetchMock);
  const repository = workspaceRepository(remote);
  await repository.loadIndex();
  await repository.movePage('source', 'target');
  expect(fetchMock.mock.calls[1]).toEqual(['https://example.org/api/workspaces/equipe/pages/source/move', expect.objectContaining({ method: 'POST', body: JSON.stringify({ parentId: 'target' }), credentials: 'include' })]);
  const updated = await repository.loadIndex();
  updated.pages[0].title = 'Renamed';
  await repository.saveIndex(updated);
  expect(JSON.parse(fetchMock.mock.calls[3][1].body).revision).toBe(2);
});
it('explains permission refusal instead of presenting it as a server outage', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
  await expect(workspaceRepository(remote).movePage('source', null)).rejects.toThrow('droits nécessaires');
});
