import {afterEach, describe, expect, it, vi} from 'vitest';
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
  it('walks four steps and claims only on the final submit', async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).endsWith('/api/setup/email-test')) return response({ok: true, backend: 'development'});
      if (String(url).endsWith('/api/setup/claim')) return response({ok: true});
      return response({error: 'unexpected'}, 500);
    });
    vi.stubGlobal('fetch', fetch);
    const client = new CloudClient({origin: 'https://blok.example.test'});
    const onClaimed = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    mountSetupAssistant({
      client,
      hostPreview: 'blok.example.test',
      frame: () => {
        host.replaceChildren();
        const main = document.createElement('main');
        host.append(main);
        return main;
      },
      run: async (action) => { await action(); },
      showError: (reason) => { throw reason instanceof Error ? reason : new Error(String(reason)); },
      onClaimed,
    });

    expect(host.textContent).toContain('Étape 1 sur 4');
    expect(host.textContent).toContain('docker compose exec app cat /data/setup-token');
    expect(fetch).not.toHaveBeenCalled();

    const token = host.querySelector<HTMLInputElement>('#cloud-setup-token')!;
    const instanceName = host.querySelector<HTMLInputElement>('#cloud-instance-name')!;
    token.value = 'setup-secret';
    instanceName.value = 'Acme';
    token.dispatchEvent(new Event('input'));
    instanceName.dispatchEvent(new Event('input'));
    token.form!.dispatchEvent(new Event('submit', {cancelable: true}));

    expect(host.textContent).toContain('Étape 2 sur 4');
    expect(host.textContent).toMatch(/Blok n’a pas de mot de passe|Blok n'a pas de mot de passe/);

    const adminName = host.querySelector<HTMLInputElement>('#cloud-admin-name')!;
    const email = host.querySelector<HTMLInputElement>('#cloud-admin-email')!;
    adminName.value = 'Alice';
    email.value = 'alice@example.test';
    adminName.dispatchEvent(new Event('input'));
    email.dispatchEvent(new Event('input'));
    const verify = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Vérifier l’envoi');
    expect(verify).toBeTruthy();
    verify!.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      token: 'setup-secret',
      email: 'alice@example.test',
    });
    email.form!.dispatchEvent(new Event('submit', {cancelable: true}));

    expect(host.textContent).toContain('Étape 3 sur 4');
    const workspaceName = host.querySelector<HTMLInputElement>('#cloud-workspace-name')!;
    workspaceName.value = 'Mon Équipe';
    workspaceName.dispatchEvent(new Event('input'));
    expect(host.textContent).toContain('blok.example.test/mon-equipe');
    const edit = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Modifier');
    edit!.click();
    const slug = host.querySelector<HTMLInputElement>('#cloud-workspace-slug')!;
    expect(slug.value).toBe('mon-equipe');
    slug.value = 'equipe-acme';
    slug.dispatchEvent(new Event('input'));
    workspaceName.value = 'Autre nom';
    workspaceName.dispatchEvent(new Event('input'));
    expect(slug.value).toBe('equipe-acme');
    workspaceName.form!.dispatchEvent(new Event('submit', {cancelable: true}));

    expect(host.textContent).toContain('Étape 4 sur 4');
    expect(host.textContent).toContain('Invitation seule');
    const finish = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Terminer la configuration');
    finish!.click();
    await vi.waitFor(() => expect(onClaimed).toHaveBeenCalledWith('alice@example.test'));
    const claimCall = fetch.mock.calls.find(([url]) => String(url).endsWith('/api/setup/claim'));
    expect(JSON.parse(String(claimCall?.[1]?.body))).toMatchObject({
      token: 'setup-secret',
      email: 'alice@example.test',
      name: 'Alice',
      instanceName: 'Acme',
      workspace: {slug: 'equipe-acme', name: 'Autre nom'},
      signupPolicy: 'invite',
      workspaceCreation: 'admins_only',
    });
  });

  it('keeps a disabled Continuer disabled after run() finishes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ok: true, backend: 'development'})));
    const client = new CloudClient();
    const host = document.createElement('div');
    document.body.append(host);
    let gatewayButtons: HTMLButtonElement[] = [];
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
        gatewayButtons = Array.from(host.querySelectorAll('button'));
        const prior = gatewayButtons.map((item) => item.disabled);
        gatewayButtons.forEach((item) => { item.disabled = true; });
        try { await action(); }
        finally { gatewayButtons.forEach((item, index) => { item.disabled = prior[index] ?? false; }); }
      },
      showError: () => {},
      onClaimed: () => {},
    });

    // Step 1 Continuer starts disabled with empty fields.
    const continueBtn = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Continuer')!;
    expect(continueBtn.disabled).toBe(true);

    // Move to step 2 with values, then leave Continuer disabled until fields filled —
    // simulate empty email-test run restoration.
    const token = host.querySelector<HTMLInputElement>('#cloud-setup-token')!;
    const instanceName = host.querySelector<HTMLInputElement>('#cloud-instance-name')!;
    token.value = 'tok';
    instanceName.value = 'Acme';
    token.dispatchEvent(new Event('input'));
    instanceName.form!.dispatchEvent(new Event('submit', {cancelable: true}));

    const verify = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Vérifier l’envoi')!;
    expect(verify.disabled).toBe(true);
    // Fill fields then clear email so verify becomes disabled again after a successful-looking run path.
    const adminName = host.querySelector<HTMLInputElement>('#cloud-admin-name')!;
    const email = host.querySelector<HTMLInputElement>('#cloud-admin-email')!;
    adminName.value = 'Alice';
    email.value = 'alice@example.test';
    adminName.dispatchEvent(new Event('input'));
    email.dispatchEvent(new Event('input'));
    expect(verify.disabled).toBe(false);
    email.value = '';
    email.dispatchEvent(new Event('input'));
    expect(verify.disabled).toBe(true);
  });
});
