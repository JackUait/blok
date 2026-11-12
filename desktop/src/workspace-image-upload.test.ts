import {afterEach, describe, expect, it, vi} from 'vitest';
import {workspaceRepository} from './workspace-repository';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe('workspace image uploads', () => {
  it('keeps local images self contained and persists their source on reopen', async () => {
    const repository = workspaceRepository({kind: 'local', id: 'default', name: 'Local'});
    const source = await repository.uploadImage('data:image/png;base64,YQ==');
    const index = await repository.loadIndex();
    index.pages[0]!.cover = source;
    index.pages[0]!.coverPosition = 23;
    await repository.saveIndex(index);
    expect((await repository.loadIndex()).pages[0]).toMatchObject({cover: source, coverPosition: 23});
  });
  it('uploads into the selected remote workspace and normalizes the persistent asset URL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ok: true, json: async () => ({url: '/files/image.png'})});
    vi.stubGlobal('fetch', fetcher);
    const repository = workspaceRepository({kind: 'remote', id: 'remote', name: 'Team', server: 'https://example.com', workspaceId: 'team one', accountId: 'account'});
    expect(await repository.uploadImage('data:image/png;base64,YQ==')).toBe('https://example.com/files/image.png');
    expect(fetcher).toHaveBeenCalledWith('https://example.com/api/workspaces/team%20one/images', expect.objectContaining({method: 'POST', credentials: 'include', body: JSON.stringify({dataUrl: 'data:image/png;base64,YQ=='})}));
  });
});
