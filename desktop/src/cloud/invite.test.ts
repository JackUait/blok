import {afterEach, describe, expect, it, vi} from 'vitest';
import {WORKSPACE_ROLES} from '../access-vocabulary';
import {CloudClient} from './client';
import {mountInviteScreen} from './invite';

function response(data: unknown, status = 200): Response {
  return {ok: status < 400, status, json: async () => data} as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('invite acceptance screen', () => {
  it('names the host, workspace, role and message when provided', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      id: 'w1', slug: 'acme', name: 'Acme', role: 'member', joinStatus: null,
    })));
    const host = document.createElement('div');
    document.body.append(host);
    mountInviteScreen({
      client: new CloudClient(),
      session: {
        user: {id: 'u1', email: 'alice@example.test'},
        workspaces: [{id: 'w1', slug: 'acme', name: 'Acme', role: 'member'}],
      },
      invite: {
        slug: 'acme',
        email: 'alice@example.test',
        host: 'Bob',
        role: 'member',
        message: 'Bienvenue dans l’équipe',
      },
      frame: () => {
        host.replaceChildren();
        const main = document.createElement('main');
        host.append(main);
        return main;
      },
      run: async (action) => { await action(); },
      showError: () => {},
      onSwitchAccount: vi.fn(),
      onContinue: vi.fn(),
      onLogin: vi.fn(),
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Bienvenue dans Acme'));
    expect(host.textContent).toContain('Invité par Bob');
    expect(host.textContent).toContain(WORKSPACE_ROLES.member);
    expect(host.textContent).toContain('Bienvenue dans l’équipe');
  });

  it('explains a wrong-account mismatch with changer de compte', async () => {
    const switchAccount = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    mountInviteScreen({
      client: new CloudClient(),
      session: {user: {id: 'u1', email: 'vous@x.fr'}, workspaces: []},
      invite: {slug: 'acme', email: 'autre@x.fr'},
      frame: () => {
        host.replaceChildren();
        const main = document.createElement('main');
        host.append(main);
        return main;
      },
      run: async (action) => { await action(); },
      showError: () => {},
      onSwitchAccount: switchAccount,
      onContinue: vi.fn(),
      onLogin: vi.fn(),
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Mauvais compte'));
    expect(host.textContent).toContain('Cette invitation est pour autre@x.fr, vous êtes connecté comme vous@x.fr');
    [...host.querySelectorAll('button')].find((item) => item.textContent === 'Changer de compte')!.click();
    await vi.waitFor(() => expect(switchAccount).toHaveBeenCalled());
  });

  it('shows expired when the workspace is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({error: 'Not found'}, 404)));
    const host = document.createElement('div');
    document.body.append(host);
    mountInviteScreen({
      client: new CloudClient(),
      session: {user: {id: 'u1', email: 'alice@example.test'}, workspaces: []},
      invite: {slug: 'gone', email: 'alice@example.test'},
      frame: () => {
        host.replaceChildren();
        const main = document.createElement('main');
        host.append(main);
        return main;
      },
      run: async (action) => { await action(); },
      showError: () => {},
      onSwitchAccount: vi.fn(),
      onContinue: vi.fn(),
      onLogin: vi.fn(),
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Invitation expirée'));
  });
});
