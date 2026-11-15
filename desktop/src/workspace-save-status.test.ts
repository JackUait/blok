import { describe, expect, it } from 'vitest';
import { createWorkspaceSaveStatus } from './workspace-save-status';

const saved = { state: 'saved' as const, pendingOperations: 0, pendingBytes: 0, quarantinedOperations: 0 };
const pending = { ...saved, state: 'pending' as const, pendingOperations: 1, pendingBytes: 32 };

describe('workspace save feedback', () => {
  it('announces remote disconnection and pending edits without claiming a durable local copy', () => {
    const status = createWorkspaceSaveStatus(true, true);
    status.connection({ status: 'offline', save: pending });
    expect(status.element.textContent).toBe('Hors-ligne · non enregistré');
    expect(status.element.title).toContain('Gardez cette page ouverte');
    expect(status.element.title).not.toContain('enregistrée sur cet appareil');
    expect(status.element.getAttribute('role')).toBe('status');
    expect(status.element.getAttribute('aria-live')).toBe('polite');
  });

  it('keeps pending work visible through reconnect until the server acknowledges it', () => {
    const status = createWorkspaceSaveStatus(true, false);
    status.connection({ status: 'offline', save: pending });
    status.online(true);
    status.connection({ status: 'connected', save: pending });
    expect(status.element.textContent).toBe('Synchronisation…');
    status.connection({ status: 'connected', save: saved });
    expect(status.element.textContent).toBe('Enregistré');
    expect(status.element.hasAttribute('data-error')).toBe(false);
  });

  it('does not report unknown, unavailable or malformed save data as saved', () => {
    const status = createWorkspaceSaveStatus(true, true);
    status.connection();
    status.connection({ status: 'connected' });
    expect(status.element.textContent).toBe('Confirmation en attente');
    status.connection({ status: 'connected', save: { ...saved, state: 'unavailable' } });
    expect(status.element.textContent).toBe('Confirmation en attente');
    status.connection({ status: 'connected', save: { ...saved, pendingBytes: 1 } });
    expect(status.element.textContent).toBe('Synchronisation…');
  });

  it('keeps failed metadata unsaved when the document session reconnects', () => {
    const status = createWorkspaceSaveStatus(true, true);
    status.error(new TypeError('Load failed'));
    status.connection({ status: 'connected', save: saved });
    expect(status.element.textContent).toBe('Hors-ligne · non enregistré');
    expect(status.element.title).not.toMatch(/TypeError|Load failed/);
    status.pending(1);
    status.saved();
    expect(status.element.textContent).toBe('Synchronisation…');
    status.pending(0);
    expect(status.element.textContent).toBe('Enregistré');
  });

  it('shows terminal and blocked states as errors even when the browser is offline', () => {
    const status = createWorkspaceSaveStatus(true, false);
    status.connection({ status: 'error', save: saved });
    expect(status.element.textContent).toBe('Enregistrement interrompu');
    status.connection({ status: 'connected', save: { ...saved, state: 'blocked' } });
    expect(status.element.hasAttribute('data-error')).toBe(true);
    status.connection({ status: 'connected', save: { ...saved, state: 'quarantined' } });
    expect(status.element.textContent).toBe('Enregistrement interrompu');
  });

  it('preserves access refusal explanations without exposing the original error', () => {
    const status = createWorkspaceSaveStatus(true, true);
    status.error(new Error('private server details'), 'Vous n’avez plus accès à cette page.');
    status.connection({ status: 'connected', save: saved });
    expect(status.element.textContent).toBe('Accès refusé');
    expect(status.element.title).toBe('Vous n’avez plus accès à cette page.');
  });

  it('distinguishes local storage from remote sync and ignores browser network loss locally', () => {
    const status = createWorkspaceSaveStatus(false, false);
    expect(status.element.textContent).toBe('Ouverture…');
    status.ready();
    expect(status.element.textContent).toBe('Sur cet appareil');
    status.pending(1);
    expect(status.element.textContent).toBe('Enregistrement…');
    status.error(new Error('disk full'));
    status.pending(0);
    expect(status.element.textContent).toBe('Enregistrement impossible');
    status.saved();
    status.online(false);
    expect(status.element.textContent).toBe('Sur cet appareil');
  });

  it('does not carry a saved remote acknowledgement over to another page', () => {
    const status = createWorkspaceSaveStatus(true, true);
    status.connection({ status: 'connected', save: saved });
    status.resetPage();
    expect(status.element.textContent).toBe('Connexion…');
  });

  it('does not let successful metadata writes hide a failed document save', () => {
    const status = createWorkspaceSaveStatus(false, true);
    status.ready();
    status.error(new Error('disk full'), null, 'document');
    status.saved('manifest');
    expect(status.element.textContent).toBe('Enregistrement impossible');
    status.saved('document');
    expect(status.element.textContent).toBe('Sur cet appareil');
  });
});
