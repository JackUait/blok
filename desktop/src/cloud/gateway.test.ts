import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountCloudGateway, CloudClient} from './index';
const user = {id:'u1', email:'alice@example.com'};
const workspace = {id:'w1', slug:'acme', name:'Acme', role:'admin'};
// Le selecteur ne s'affiche qu'a partir de deux espaces : un seul ouvre directement.
// Les tests qui visent ses boutons (Gerer, Changer de compte) en declarent donc un second.
const second = {id:'w2', slug:'autre-espace', name:'Autre espace', role:'member'};
const instance = {
  name: 'Acme',
  setupRequired: false,
  signupPolicy: 'invite',
  workspaceCreation: 'anyone',
  defaultWorkspace: {slug: workspace.slug, name: workspace.name},
};
function response(data: unknown, status = 200): Response { return {ok:status < 400, status, json:async () => data} as Response; }
function click(text: string): void { const button = [...document.querySelectorAll('button')].find(item => item.textContent === text); expect(button).toBeTruthy(); button!.click(); }
async function settle(): Promise<void> {await vi.waitFor(() => {expect(document.querySelector('button:disabled')).toBeNull();});}
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/instance')) return response(instance);
    return handler(String(url), init);
  }));
}
afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
describe('cloud gateway', () => {
  it('keeps a pending applicant outside the editor and refreshes status', async () => {
    const open = vi.fn();
    stubFetch(async (url) => response(url.endsWith('/api/session') ? {user, workspaces:[]} : {...workspace, role:null, joinStatus:'pending'}));
    await mountCloudGateway(document.body, {onOpenWorkspace:open});
    expect(document.body.textContent).toContain('Votre demande est en attente');
    expect(document.body.textContent).not.toContain('Ouvrir l’espace');
    expect(open).not.toHaveBeenCalled();
    click('Actualiser le statut'); await settle();
    expect(open).not.toHaveBeenCalled();
  });
  it('shows a refused request without offering editor access', async () => {
    const open = vi.fn(); stubFetch(async (url) => response(url.endsWith('/api/session') ? {user,workspaces:[]} : {...workspace,role:null,joinStatus:'rejected'}));
    await mountCloudGateway(document.body, {onOpenWorkspace:open});
    expect(document.body.textContent).toContain('Votre demande n’a pas été acceptée'); expect(open).not.toHaveBeenCalled();
  });
  it('shows the dedicated unreachable screen when the instance fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()});
    expect(document.querySelector('[data-cloud-route]')?.getAttribute('data-cloud-route')).toBe('unreachable');
    expect(document.body.textContent).toContain('Serveur injoignable');
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect([...document.querySelectorAll('button')].some(item => item.textContent === 'Réessayer')).toBe(true);
  });
  it('routes setupRequired to the setup assistant and never shows the login form', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/instance')) return response({...instance, setupRequired:true, defaultWorkspace:null});
      return response({error:'Unauthorized'}, 401);
    });
    vi.stubGlobal('fetch', fetch);
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()});
    expect(document.querySelector('[data-cloud-route]')?.getAttribute('data-cloud-route')).toBe('setup');
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(document.body.textContent).toContain('Étape 1 sur 4');
    expect(document.body.textContent).toContain('Cette instance');
    expect(document.body.textContent).toContain('docker compose exec app cat /data/setup-token');
    expect(document.body.textContent).not.toMatch(/Coming soon/i);
    // Re-fetch before render — never trust a single cached setupRequired.
    const instanceCalls = fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/instance'));
    expect(instanceCalls.length).toBeGreaterThanOrEqual(2);
  });
  it('keeps email and OTP semantics while using the shared editor fields',async()=>{
    stubFetch(async(url)=>url.endsWith('/api/session')?response({error:'Unauthorized'},401):response({ok:true}));
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()});const email=document.querySelector<HTMLInputElement>('#cloud-email')!;expect(email.type).toBe('email');expect(email.autocomplete).toBe('email');expect(email.getAttribute('data-blok-field')).toBe('text');email.value='alice@example.test';email.form!.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
    const code=document.querySelector<HTMLInputElement>('#cloud-code')!;expect(code.autocomplete).toBe('one-time-code');expect(code.inputMode).toBe('numeric');expect(code.pattern).toBe('[0-9]{6}');expect(code.getAttribute('data-blok-field')).toBe('text');
  });
  it('opens a workspace only on explicit selection when several are available', async () => {
    const open = vi.fn(); stubFetch(async (url) => response(url.endsWith('/api/session') ? {user,workspaces:[workspace,second]} : {...workspace,joinStatus:'approved'}));
    await mountCloudGateway(document.body,{onOpenWorkspace:open});
    expect(document.body.textContent).toContain('Où souhaitez-vous travailler ?');
    expect(open).not.toHaveBeenCalled();
    click('Ouvrir l’espace'); await settle(); expect(open).toHaveBeenCalledWith(workspace, expect.any(CloudClient));
  });
  it('enters the only workspace without asking where to work', async () => {
    const open = vi.fn(); stubFetch(async (url) => response(url.endsWith('/api/session') ? {user,workspaces:[workspace]} : {...workspace,joinStatus:'approved'}));
    await mountCloudGateway(document.body,{onOpenWorkspace:open});
    expect(open).toHaveBeenCalledWith(workspace, expect.any(CloudClient));
    expect(document.body.textContent).not.toContain('Où souhaitez-vous travailler ?');
  });
  it('still asks where to work when no workspace is joined yet', async () => {
    const open = vi.fn(); stubFetch(async (url) => response(url.endsWith('/api/session') ? {user,workspaces:[]} : {...workspace,role:null,joinStatus:null}));
    await mountCloudGateway(document.body,{onOpenWorkspace:open});
    expect(open).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Où souhaitez-vous travailler ?');
  });
  it('uses instance.defaultWorkspace for the join panel, not a hardcoded slug', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/instance')) return response(instance);
      if (String(url).endsWith('/api/session')) return response({user,workspaces:[]});
      return response({...workspace,role:null,joinStatus:null});
    });
    vi.stubGlobal('fetch', fetch);
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()});
    const workspaceCalls = fetch.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/api/workspaces/'));
    expect(workspaceCalls.some(url => url.endsWith(`/api/workspaces/${workspace.slug}`))).toBe(true);
    expect(workspaceCalls.every(url => url.includes(`/api/workspaces/${workspace.slug}`))).toBe(true);
    expect(document.body.textContent).toContain(workspace.name);
  });
});
describe('cloud account and server selection', () => {
  it('revokes the current session before switching accounts', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/instance')) return response(instance);
      return response(String(url).endsWith('/api/session') ? {user,workspaces:[workspace,second]} : {...workspace,joinStatus:'approved'});
    });
    vi.stubGlobal('fetch',fetch);
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()}); click('Changer de compte'); await settle();
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/api/auth/logout'))).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe('');
    expect(document.body.textContent).not.toContain(user.email);
  });
  it('prefills the server origin and normalizes a new HTTPS server', async () => {
    stubFetch(async () => response({error:'Unauthorized'},401));
    const change = vi.fn(); await mountCloudGateway(document.body,{apiOrigin:'https://current.example.test',onOpenWorkspace:vi.fn(),onServerChange:change});
    const input = document.querySelector<HTMLInputElement>('#cloud-server')!;
    expect(input.value).toBe('https://current.example.test'); input.value = 'https://new.example.test/path';
    input.form!.dispatchEvent(new Event('submit',{cancelable:true})); await settle(); expect(change).toHaveBeenCalledWith('https://new.example.test');
  });
  it('rejects a credentialed server without changing the connection', async () => {
    stubFetch(async () => response({error:'Unauthorized'},401));
    const change = vi.fn(); await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),onServerChange:change});
    const input = document.querySelector<HTMLInputElement>('#cloud-server')!; input.value = 'https://alice:secret@example.test';
    input.form!.dispatchEvent(new Event('submit',{cancelable:true})); await settle(); expect(change).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('sans identifiants');
  });
});
describe('direct workspace administration', () => {
  it('opens the managed workspace instead of a duplicate members screen', async () => {
    stubFetch(async (url) => response(url.endsWith('/api/session') ? {user,workspaces:[workspace]} : {...workspace,joinStatus:'approved'}));
    const open = vi.fn();
    await mountCloudGateway(document.body,{onOpenWorkspace:open,initialManage:{slug:workspace.slug,section:'invites'}});
    expect(open).toHaveBeenCalledWith(workspace, expect.any(CloudClient));
    expect(document.body.textContent).not.toContain('Gérez les accès à cet espace de travail.');
    expect(document.body.textContent).not.toContain('Où souhaitez-vous travailler ?');
  });
  it.each(['member','viewer','missing'])('falls back to the selector for an unauthorized %s route', async role => {
    stubFetch(async (url) => response(url.endsWith('/api/session') ? {user,workspaces:role === 'missing' ? [] : [{...workspace,role}]} : {...workspace,role:role === 'missing' ? null : role,joinStatus:null}));
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),initialManage:{slug:workspace.slug,section:'invites'}});
    expect(document.body.textContent).toContain('Où souhaitez-vous travailler ?');
    expect(document.querySelector('input[type="email"]')).toBeNull();
  });
  it.each([false,true])('hides local workspace actions when disabled (authenticated %s)', async authenticated => {
    stubFetch(async (url) => authenticated ? response(url.endsWith('/api/session') ? {user,workspaces:[workspace]} : {...workspace,joinStatus:'approved'}) : response({error:'Unauthorized'},401));
    const local = vi.fn(); await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),onOpenLocal:local,allowLocal:false});
    expect(document.body.textContent).not.toContain('espace local'); expect(local).not.toHaveBeenCalled();
  });
  it('retains native local workspace access when explicitly enabled', async () => {
    stubFetch(async () => response({error:'Unauthorized'},401));
    const local = vi.fn(); await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),onOpenLocal:local,allowLocal:true});
    click('Continuer avec un espace local'); await settle(); expect(local).toHaveBeenCalledOnce();
  });
  it('opens dedicated create-workspace and join screens from the spaces list', async () => {
    stubFetch(async (url) => response(url.endsWith('/api/session') ? {user,workspaces:[]} : {...workspace,role:null,joinStatus:null}));
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()});
    click('Créer un espace de travail'); await settle();
    expect(document.querySelector('[data-cloud-route]')?.getAttribute('data-cloud-route')).toBe('create-workspace');
    expect(document.body.textContent).toContain('Créer un espace de travail');
    click('Retour'); await settle();
    click('Rejoindre un espace'); await settle();
    expect(document.querySelector('[data-cloud-route]')?.getAttribute('data-cloud-route')).toBe('join');
    expect(document.body.textContent).toContain('Rejoindre un espace');
  });
});
describe('cloud native credentials', () => {
  it('keeps the bearer credential in the supplied secure adapter', async () => {
    const adapter = {getToken:vi.fn(async () => null),setToken:vi.fn(async () => {})};
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response({user,workspaces:[],token:'secret'})); vi.stubGlobal('fetch',fetch);
    const client = new CloudClient({origin:'https://example.com/',sessionAdapter:adapter}); await client.verifyCode(user.email,'123456');
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject({client:'desktop'});
    expect(adapter.setToken).toHaveBeenCalledWith('secret'); expect(client.currentSession?.user).toEqual(user);
  });
  it('sends secure stored credentials and never requests desktop tokens in the browser', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response({user,workspaces:[]})); vi.stubGlobal('fetch',fetch);
    await new CloudClient().verifyCode(user.email,'123456');
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty('client');
    const native = new CloudClient({sessionAdapter:{getToken:async () => 'secret',setToken:async () => {}}}); await native.session();
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer secret');
  });
});
