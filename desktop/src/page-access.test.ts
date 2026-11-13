import { describe, expect, it } from 'vitest';
import { pageAccess } from './page-access';
import type { RemoteWorkspace, LocalWorkspace } from './workspace-registry';

const remote = (role: 'admin' | 'member' | 'viewer'): RemoteWorkspace =>
  ({ kind: 'remote', id: 'r', name: 'Équipe', server: 'https://example.org', accountId: 'a', workspaceId: 'equipe', role });
const local: LocalWorkspace = { kind: 'local', id: 'l', name: 'Local' };

describe('page access', () => {
  it('reads the level the server reported for each page, not one flag for the whole workspace', () => {
    const access = pageAccess(remote('member'), { lecture: { level: 'view' }, ecriture: { level: 'edit' }, mienne: { level: 'full' } });
    expect(access.canEdit('lecture')).toBe(false);
    expect(access.canEdit('ecriture')).toBe(true);
    expect(access.canEdit('mienne')).toBe(true);
  });

  it('separates editing from governing access', () => {
    const access = pageAccess(remote('member'), { ecriture: { level: 'edit' }, mienne: { level: 'full' } });
    expect(access.canShare('ecriture')).toBe(false);
    expect(access.canShare('mienne')).toBe(true);
  });

  // Sans cela l'éditeur s'ouvrirait modifiable sur une page dont le niveau n'est
  // pas encore connu, et l'utilisateur perdrait sa frappe au premier refus.
  it('closes on an unknown page rather than guessing', () => {
    const access = pageAccess(remote('member'), { connue: { level: 'edit' } });
    expect(access.canEdit('jamais-vue')).toBe(false);
    expect(access.canEdit('')).toBe(false);
  });

  it('keeps a viewer read-only whatever the page says', () => {
    const access = pageAccess(remote('viewer'), { ecriture: { level: 'edit' }, mienne: { level: 'full' } });
    expect(access.canEdit('ecriture')).toBe(false);
    expect(access.canShare('mienne')).toBe(false);
    expect(access.readOnlyWorkspace).toBe(true);
  });

  it('leaves a local workspace entirely editable', () => {
    const access = pageAccess(local, undefined);
    expect(access.canEdit('whatever')).toBe(true);
    expect(access.readOnlyWorkspace).toBe(false);
    // Rien à partager hors d'un serveur.
    expect(access.canShare('whatever')).toBe(false);
  });

  // Un serveur plus ancien ne renvoie pas encore les niveaux : l'interface ne
  // doit pas se verrouiller pour autant.
  it('falls back to the workspace role when the server reports nothing', () => {
    expect(pageAccess(remote('member'), undefined).canEdit('page')).toBe(true);
    expect(pageAccess(remote('viewer'), undefined).canEdit('page')).toBe(false);
    expect(pageAccess(remote('admin'), undefined).canShare('page')).toBe(true);
  });

  it('tells a page detached from a hidden parent', () => {
    const access = pageAccess(remote('member'), { partagee: { level: 'edit', sharedRoot: true }, mienne: { level: 'full' } });
    expect(access.isSharedRoot('partagee')).toBe(true);
    expect(access.isSharedRoot('mienne')).toBe(false);
  });
});
