import {afterEach, describe, expect, it, vi} from 'vitest';
import {must, requestBody} from '../test-helpers';
import {CloudClient} from './client';
import {deriveWorkspaceSlug, mountSetupAssistant} from './setup';

function response(data: unknown, status = 200): Response {
  return {ok: status < 400, status, json: async () => data} as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('deriveWorkspaceSlug', () => {
  it('derives a stable slug from a display name', () => {
    expect(deriveWorkspaceSlug('Mon Équipe')).toBe('mon-equipe');
    expect(deriveWorkspaceSlug('  Acme Corp!! ')).toBe('acme-corp');
    expect(deriveWorkspaceSlug('')).toBe('espace');
  });
});

describe('setup assistant', () => {
  it('asks for a name and an address, and nothing else', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response({ok: true, backend: 'development'}));
    vi.stubGlobal('fetch', fetch);
    const onClaimed = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    mountSetupAssistant({
      client: new CloudClient({origin: 'http://blok.example.test'}),
      frame: () => { host.replaceChildren(); return host; },
      run: async (action) => { await action(); },
      showError: (reason) => { throw reason instanceof Error ? reason : new Error(String(reason)); },
      onClaimed,
    });

    // One screen. No step counter, no instance name, no workspace, no policies:
    // each has a default and a settings page.
    expect(host.textContent).not.toMatch(/Étape \d/);
    expect(host.querySelector('#cloud-instance-name')).toBeNull();
    expect(host.querySelector('#cloud-workspace-name')).toBeNull();
    expect(host.textContent).not.toContain('Qui peut entrer');
    expect(host.textContent).toContain('Réglages → Instance');
    expect(fetch).not.toHaveBeenCalled();

    const adminName = must(host.querySelector<HTMLInputElement>('#cloud-admin-name'));
    const email = must(host.querySelector<HTMLInputElement>('#cloud-admin-email'));
    adminName.value = 'Alice';
    email.value = 'alice@example.test';
    adminName.dispatchEvent(new Event('input'));
    email.dispatchEvent(new Event('input'));

    const verify = must([...host.querySelectorAll('button')].find((item) => item.textContent === 'Vérifier l’envoi'));
    verify.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(requestBody(fetch.mock.calls[0]?.[1]))).toMatchObject({email: 'alice@example.test'});

    must(email.form).dispatchEvent(new Event('submit', {cancelable: true}));
    await vi.waitFor(() => expect(onClaimed).toHaveBeenCalledWith('alice@example.test'));
    const claimCall = fetch.mock.calls.find(([url]) => String(url).endsWith('/api/setup/claim'));
    expect(JSON.parse(requestBody(claimCall?.[1]))).toEqual({
      email: 'alice@example.test',
      name: 'Alice',
    });
  });

  it('keeps a disabled Continuer disabled after run() finishes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ok: true, backend: 'development'})));
    const client = new CloudClient();
    const host = document.createElement('div');
    document.body.append(host);
    const runState = { gatewayButtons: [] as HTMLButtonElement[] };
    const view = document.createElement('div');
    document.body.append(view);

    mountSetupAssistant({
      client,
      frame: () => {
        host.replaceChildren();
        const main = document.createElement('main');
        host.append(main);
        return main;
      },
      run: async (action) => {
        runState.gatewayButtons = Array.from(host.querySelectorAll('button'));
        const prior = runState.gatewayButtons.map((button) => button.disabled);
        for (const button of runState.gatewayButtons) button.disabled = true;
        try { await action(); }
        finally {
          for (const [index, button] of runState.gatewayButtons.entries()) {
            button.disabled = prior[index] ?? false;
          }
        }
      },
      showError: () => {},
      onClaimed: () => {},
    });

    // The submit starts disabled on empty fields, and a run() that disables every
    // button must restore that state rather than resurrect it.
    const finish = must([...host.querySelectorAll('button')].find((item) => item.textContent === 'Créer l’instance'));
    const verify = must([...host.querySelectorAll('button')].find((item) => item.textContent === 'Vérifier l’envoi'));
    expect(finish.disabled).toBe(true);
    expect(verify.disabled).toBe(true);

    const adminName = must(host.querySelector<HTMLInputElement>('#cloud-admin-name'));
    const email = must(host.querySelector<HTMLInputElement>('#cloud-admin-email'));
    adminName.value = 'Alice';
    email.value = 'alice@example.test';
    adminName.dispatchEvent(new Event('input'));
    email.dispatchEvent(new Event('input'));
    expect(finish.disabled).toBe(false);

    verify.click();
    await vi.waitFor(() => expect(finish.disabled).toBe(false));

    // Emptying the address disables both again.
    email.value = '';
    email.dispatchEvent(new Event('input'));
    expect(finish.disabled).toBe(true);
    expect(verify.disabled).toBe(true);
  });
});
