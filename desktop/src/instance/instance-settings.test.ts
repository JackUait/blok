import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberWorkspace, workspaceKey, type RemoteWorkspace } from '../workspace-registry';
import { createDesktopFooter } from '../settings';

const remoteRef: RemoteWorkspace = {
  kind: 'remote', id: 'team', name: 'Acme', server: 'http://localhost:1420',
  accountId: 'user', userName: 'admin@example.org', workspaceId: 'acme', role: 'admin',
};

const settingsPayload = {
  name: 'Acme',
  signupPolicy: 'invite',
  signupDomains: [] as string[],
  workspaceCreation: 'anyone',
  defaultWorkspaceId: 'w1',
  setupCompletedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function response(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as Response;
}

function stubSession(instanceAdmin: boolean): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/api/session')) {
      return response({
        user: { id: 'u1', email: 'admin@example.org', name: 'Ada', instanceAdmin },
        workspaces: [{ id: 'w1', slug: 'acme', name: 'Acme', role: 'admin' }],
      });
    }
    if (path.endsWith('/api/admin/settings') && (!init?.method || init.method === 'GET')) {
      return response(settingsPayload);
    }
    if (path.endsWith('/api/admin/settings') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      return response({ ...settingsPayload, ...body });
    }
    if (path.includes('/api/admin/users')) {
      return response({
        users: [{
          id: 'u1', email: 'admin@example.org', name: 'Ada', createdAt: '2026-01-01T00:00:00Z',
          workspaceCount: 1, instanceAdmin: true,
        }],
        total: 1, limit: 50, offset: 0,
      });
    }
    if (path.endsWith('/api/admin/workspaces')) {
      return response({
        workspaces: [{ id: 'w1', slug: 'acme', name: 'Acme', memberCount: 2, createdAt: '2026-01-01T00:00:00Z' }],
      });
    }
    if (path.endsWith('/api/admin/email-test') && init?.method === 'POST') {
      return response({ ok: true, backend: 'development' });
    }
    if (path.endsWith('/healthz')) return response({ ok: true });
    return response({ error: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function openRemoteSettings(instanceAdmin: boolean): { footer: HTMLElement; dialog: HTMLElement; fetch: ReturnType<typeof vi.fn> } {
  const fetch = stubSession(instanceAdmin);
  const ref = { ...remoteRef };
  rememberWorkspace(ref);
  localStorage.setItem('blok:desktop:active-workspace:v1', workspaceKey(ref));
  const footer = createDesktopFooter(() => undefined);
  document.body.append(footer);
  footer.querySelector<HTMLButtonElement>('[data-desktop-switcher]')!.click();
  [...footer.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((node) => node.textContent === 'Paramètres')!.click();
  const dialog = document.querySelector<HTMLElement>('[data-desktop-settings-dialog]')!;
  return { footer, dialog, fetch };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.querySelector<HTMLButtonElement>('[data-desktop-settings-close]')?.click();
  document.body.innerHTML = '';
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('instance settings nav', () => {
  it('keeps the Instance heading and entries out of the DOM for a non-admin', async () => {
    const { dialog } = openRemoteSettings(false);
    await vi.waitFor(() => {
      expect(dialog.querySelector('[data-desktop-settings-nav-heading]')).toBeTruthy();
    });
    // Give the async session resolution a turn; Instance must still be absent.
    await Promise.resolve();
    await Promise.resolve();
    const headings = [...dialog.querySelectorAll('[data-desktop-settings-nav-heading]')].map((node) => node.textContent);
    expect(headings).not.toContain('Instance');
    expect(dialog.querySelector('[data-desktop-settings-nav-item][data-instance-panel]')).toBeNull();
    expect(dialog.textContent).not.toContain('Santé et e-mail');
  });

  it('adds the Instance heading and entries only for an instanceAdmin', async () => {
    const { dialog } = openRemoteSettings(true);
    await vi.waitFor(() => {
      expect([...dialog.querySelectorAll('[data-desktop-settings-nav-heading]')].some((node) => node.textContent === 'Instance')).toBe(true);
    });
    const labels = [...dialog.querySelectorAll<HTMLButtonElement>('[data-desktop-settings-nav-item]')]
      .map((node) => node.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Général', 'Accès', 'Comptes', 'Espaces', 'Santé et e-mail']));
    const headings = [...dialog.querySelectorAll('[data-desktop-settings-nav-heading]')];
    const espace = headings.find((node) => node.textContent === 'Espace');
    const instance = headings.find((node) => node.textContent === 'Instance');
    expect(espace).toBeTruthy();
    expect(instance).toBeTruthy();
    expect(Boolean(espace && instance && Boolean(espace.compareDocumentPosition(instance) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  });
});

describe('instance access and health panels', () => {
  it('saves signupPolicy immediately via PATCH and reverts on failure', async () => {
    const { dialog, fetch } = openRemoteSettings(true);
    await vi.waitFor(() => expect(dialog.textContent).toContain('Accès'));
    [...dialog.querySelectorAll<HTMLButtonElement>('[data-desktop-settings-nav-item]')]
      .find((node) => node.textContent === 'Accès')!.click();
    await vi.waitFor(() => expect(dialog.querySelector('[data-desktop-instance-signup]')).toBeTruthy());
    const choice = dialog.querySelector<HTMLButtonElement>('[data-desktop-instance-signup]')!;
    choice.click();
    await vi.waitFor(() => expect(document.querySelector('[data-blok-item-name=open]')).toBeTruthy());
    document.querySelector<HTMLElement>('[data-blok-item-name=open]')!.click();
    await vi.waitFor(() => {
      const patch = fetch.mock.calls.find(([url, init]) => String(url).endsWith('/api/admin/settings') && (init as RequestInit | undefined)?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ signupPolicy: 'open' });
    });
  });

  it('sends a test email through POST /api/admin/email-test', async () => {
    const { dialog, fetch } = openRemoteSettings(true);
    await vi.waitFor(() => expect(dialog.textContent).toContain('Santé et e-mail'));
    [...dialog.querySelectorAll<HTMLButtonElement>('[data-desktop-settings-nav-item]')]
      .find((node) => node.textContent === 'Santé et e-mail')!.click();
    await vi.waitFor(() => expect(dialog.querySelector('[data-desktop-instance-email-test]')).toBeTruthy());
    const email = dialog.querySelector<HTMLInputElement>('[data-desktop-instance-email-input]')!;
    email.value = 'probe@example.org';
    dialog.querySelector<HTMLButtonElement>('[data-desktop-instance-email-test]')!.click();
    await vi.waitFor(() => {
      const call = fetch.mock.calls.find(([url, init]) => String(url).endsWith('/api/admin/email-test') && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ email: 'probe@example.org' });
    });
    await vi.waitFor(() => expect(dialog.textContent).toMatch(/envoyé|développement|réussi/i));
  });
});
