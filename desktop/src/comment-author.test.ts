import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commentAuthor } from './comment-author';
import type { WorkspaceRef } from './workspace-registry';
const local: WorkspaceRef = { kind: 'local', id: 'one', name: 'Local' };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());
it('uses the signed-in remote account and its supplied display name', () => {
  expect(commentAuthor({ kind: 'remote', id: 'cloud', server: 'https://example.test', workspaceId: 'w', accountId: 'user-1', userName: 'Camille', name: 'Team' })).toEqual({ authorId: 'user-1', authorName: 'Camille' });
});
it('persists a distinct local author across workspace navigation without inventing a profile name', () => {
  const author = commentAuthor(local);
  expect(author.authorId).toMatch(/^local:[a-f0-9-]+$/);
  expect(author.authorName).toBe('Utilisateur local');
  expect(commentAuthor({ ...local, id: 'two' })).toEqual(author);
  expect(localStorage.getItem('blok:desktop:comment-author:v1')).toBe(author.authorId);
});
it('keeps one session identity when preferences are unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  expect(commentAuthor(local)).toEqual(commentAuthor(local));
});
