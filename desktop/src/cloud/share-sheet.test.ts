import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_LEVELS, PAGE_RIGHTS_CUMULATIVE } from '../access-vocabulary';
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
    if (_path.endsWith('/members')) return { members: [{ id: 'bob', email: 'bob@example.test' }] };
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
  it('only requests member suggestions for people who may manage access', async () => {
    const instance = client({ get: sheet({ myLevel: 'view' }) });
    const { host } = await mount(instance);
    expect(host.querySelector<HTMLElement>('[data-cloud-share-invitation]')!.hidden).toBe(true);
    expect(instance.request).not.toHaveBeenCalledWith(expect.stringContaining('/members'));
  });

  it('notifies navigation after an individual share changes, without opening the page to the workspace', async () => {
    const instance = client();
    const onChanged = vi.fn();
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountShareSheet(host, { client: instance, slug: 'equipe', pageId: 'p', pageTitle: 'Privé', onChanged });
    await vi.waitFor(() => expect(host.querySelector('[data-cloud-share-row]')).not.toBeNull());
    await (host.querySelector('[data-cloud-share-sheet]') as HTMLElement & { testChange: (u: string, l: string) => Promise<void> }).testChange('bob', 'view');
    expect(instance.request).toHaveBeenCalledWith('/api/workspaces/equipe/pages/p/shares/bob', { method: 'PUT', body: JSON.stringify({ level: 'view' }) });
    expect(instance.request).not.toHaveBeenCalledWith(expect.stringContaining('/access'), expect.objectContaining({ method: 'PUT' }));
    expect(onChanged).toHaveBeenCalledOnce();
    handle.destroy();
  });
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
    expect(control?.textContent).toContain(PAGE_LEVELS.edit);
    await (host.querySelector('[data-cloud-share-sheet]') as HTMLElement & { testChange?: (u: string, l: string) => Promise<void> }).testChange?.('alice', 'view');
    await vi.waitFor(() => expect(host.querySelector('[data-cloud-share-error]')?.textContent).toBeTruthy());
    expect(control?.textContent).toContain(PAGE_LEVELS.edit);
  });

  it('says who the page is open to, in plain words', async () => {
    const { host } = await mount(client({ get: sheet({ visibility: 'workspace', effectiveVisibility: 'workspace' }) }));
    expect(host.querySelector('[data-cloud-share-visibility]')?.textContent).toContain('espace');
  });

  it('names the cumulative ceiling so a workspace viewer is not promised edit', async () => {
    const { host } = await mount(client());
    const line = host.querySelector('[data-cloud-share-cumulative]');
    expect(line?.textContent).toBe(PAGE_RIGHTS_CUMULATIVE);
  });
});
