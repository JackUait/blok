import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceRepository } from './workspace-repository';
import { pageAccess } from './page-access';
import type { RemoteWorkspace } from './workspace-registry';

const remote: RemoteWorkspace = { kind: 'remote', id: 'r', name: 'Équipe', server: 'https://example.org', accountId: 'a', workspaceId: 'equipe', role: 'member' };

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('page levels reaching the interface', () => {
  // Sans ce transport, l'interface retomberait sur le rôle d'espace et rouvrirait
  // en écriture une page que le serveur refuse.
  it('keeps the levels the index reports', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pages: [{ id: 'mienne', title: 'Mienne', parentId: null }, { id: 'lue', title: 'Lue', parentId: null }],
      trash: [], revision: 3,
      access: { mienne: { level: 'full' }, lue: { level: 'view' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const index = await workspaceRepository(remote).loadIndex();
    const access = pageAccess(remote, index.access);
    expect(access.canEdit('mienne')).toBe(true);
    expect(access.canEdit('lue')).toBe(false);
    expect(access.canShare('mienne')).toBe(true);
  });

  it('stays usable against a server that reports no levels at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pages: [{ id: 'page', title: 'Page', parentId: null }], trash: [], revision: 1,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const index = await workspaceRepository(remote).loadIndex();
    expect(index.access).toBeUndefined();
    expect(pageAccess(remote, index.access).canEdit('page')).toBe(true);
  });
});
