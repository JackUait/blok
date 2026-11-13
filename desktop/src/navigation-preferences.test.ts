import { beforeEach, expect, it } from 'vitest';
import { navigationFavorites, navigationRecents } from './navigation-preferences';
import type { RemoteWorkspace } from './workspace-registry';
const ref: RemoteWorkspace = { kind: 'remote', id: 'one', name: 'Équipe', server: 'https://blok.example.com', accountId: 'alice', workspaceId: 'team' };
beforeEach(() => localStorage.clear());
it('persists recent order for this account and workspace only', () => {
  navigationRecents(ref).save(['b', 'a']);
  expect(navigationRecents(ref).ids).toEqual(['b', 'a']);
  expect(navigationRecents({ ...ref, accountId: 'bob' }).ids).toEqual([]);
  expect(navigationRecents({ ...ref, workspaceId: 'another' }).ids).toEqual([]);
});
it('retains personal favorites after reloading without leaking to another account or workspace', () => {
  navigationFavorites(ref).set('wiki', true);
  expect(navigationFavorites(ref).has('wiki')).toBe(true);
  expect(navigationFavorites({ ...ref, accountId: 'bob' }).has('wiki')).toBe(false);
  expect(navigationFavorites({ ...ref, workspaceId: 'another' }).has('wiki')).toBe(false);
  navigationFavorites(ref).set('wiki', false);
  expect(navigationFavorites(ref).has('wiki')).toBe(false);
});
