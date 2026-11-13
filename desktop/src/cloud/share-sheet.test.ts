import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountShareSheet, type PageAccessSheet } from './share-sheet';
import { CloudClient } from './client';

const sheet = (over: Partial<PageAccessSheet> = {}): PageAccessSheet => ({
  visibility: 'private',
  effectiveVisibility: 'private',
  myLevel: 'full',
  shares: [{ userId: 'alice', email: 'alice@example.test', level: 'edit' }],
  inherited: [{ userId: 'zoe', email: 'zoe@example.test', level: 'view', from: 'parent' }],
  ...over,
});

function client(responses: { get?: PageAccessSheet; fail?: boolean } = {}): CloudClient {
  const instance = new CloudClient({ origin: 'https://example.org' });
  vi.spyOn(instance, 'request').mockImplementation(async (_path: string, init?: RequestInit) => {
    if (!init || init.method === undefined || init.method === 'GET') return responses.get ?? sheet();
    if (responses.fail) throw new Error('Refusé');
    return { ok: true };
  });
  return instance;
}

const mount = async (instance: CloudClient, pageTitle = 'Page') => {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountShareSheet(host, { client: instance, slug: 'equipe', pageId: 'p', pageTitle });
  await vi.waitFor(() => expect(host.querySelector('[data-cloud-share-row]')).not.toBeNull());
  return { host, handle };
};

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('share sheet', () => {
  it('separates rights decided here from rights that come from a parent', async () => {
    const { host } = await mount(client());
    const own = host.querySelectorAll('[data-cloud-share-row]:not([data-cloud-share-inherited])');
    const inherited = host.querySelectorAll('[data-cloud-share-row][data-cloud-share-inherited]');
    expect(own).toHaveLength(1);
    expect(inherited).toHaveLength(1);
    expect(own[0].textContent).toContain('alice@example.test');
    // Nommer la page d'origine est ce qui explique pourquoi le droit ne se
    // retire pas ici.
    expect(inherited[0].textContent).toContain('parent');
  });

  it('leaves an inherited right without a control to change it', async () => {
    const { host } = await mount(client());
    const inherited = host.querySelector('[data-cloud-share-inherited]');
    expect(inherited?.querySelector('button:not([disabled])')).toBeNull();
  });

  // Consultable et inerte : voir qui a accès n'est pas gouverner l'accès.
  it('is readable but inert without full access', async () => {
    const { host } = await mount(client({ get: sheet({ myLevel: 'view' }) }));
    expect(host.textContent).toContain('alice@example.test');
    for (const control of host.querySelectorAll('button')) expect(control.disabled).toBe(true);
  });

  it('restores the shown value when the server refuses', async () => {
    const instance = client({ fail: true });
    const { host } = await mount(instance);
    const row = host.querySelector('[data-cloud-share-row]:not([data-cloud-share-inherited])');
    const control = row?.querySelector<HTMLButtonElement>('[data-desktop-choice]');
    expect(control?.textContent).toContain('Peut modifier');
    await (host.querySelector('[data-cloud-share-sheet]') as HTMLElement & { testChange?: (u: string, l: string) => Promise<void> }).testChange?.('alice', 'view');
    await vi.waitFor(() => expect(host.querySelector('[data-cloud-share-error]')?.textContent).toBeTruthy());
    expect(control?.textContent).toContain('Peut modifier');
  });

  it('says who the page is open to, in plain words', async () => {
    const { host } = await mount(client({ get: sheet({ visibility: 'workspace', effectiveVisibility: 'workspace' }) }));
    expect(host.querySelector('[data-cloud-share-visibility]')?.textContent).toContain('espace');
  });
});
