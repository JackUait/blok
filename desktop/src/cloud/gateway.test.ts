import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountCloudGateway, CloudClient} from './index';
const user = {id:'u1', email:'alice@example.com'};
const workspace = {id:'w1', slug:'tousambassadeurs', name:'Tousambassadeurs', role:'admin'};
function response(data: unknown, status = 200): Response { return {ok:status < 400, status, json:async () => data} as Response; }
function click(text: string): void { const button = [...document.querySelectorAll('button')].find(item => item.textContent === text); expect(button).toBeTruthy(); button!.click(); }
async function settle(): Promise<void> {await vi.waitFor(() => {expect(document.querySelector('button:disabled')).toBeNull();});}
afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
describe('cloud gateway', () => {
  it('keeps a pending applicant outside the editor and refreshes status', async () => {
    const open = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/api/session') ? {user, workspaces:[]} : {...workspace, role:null, joinStatus:'pending'})));
    await mountCloudGateway(document.body, {onOpenWorkspace:open});
    expect(document.body.textContent).toContain('Votre demande est en attente');
    expect(document.body.textContent).not.toContain('Ouvrir l’espace');
    expect(open).not.toHaveBeenCalled();
    click('Actualiser le statut'); await settle();
    expect(open).not.toHaveBeenCalled();
  });
  it('shows a refused request without offering editor access', async () => {
    const open = vi.fn(); vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/api/session') ? {user,workspaces:[]} : {...workspace,role:null,joinStatus:'rejected'})));
    await mountCloudGateway(document.body, {onOpenWorkspace:open});
    expect(document.body.textContent).toContain('Votre demande n’a pas été acceptée'); expect(open).not.toHaveBeenCalled();
  });
  it('shows connection errors and permits another login attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()});
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Connexion au serveur impossible');
    expect(document.querySelector('input[type="email"]')).toBeTruthy();
  });
  it('keeps email and OTP semantics while using the shared editor fields',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/api/session')?response({error:'Unauthorized'},401):response({ok:true})));
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()});const email=document.querySelector<HTMLInputElement>('#cloud-email')!;expect(email.type).toBe('email');expect(email.autocomplete).toBe('email');expect(email.getAttribute('data-blok-field')).toBe('text');email.value='alice@example.test';email.form!.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
    const code=document.querySelector<HTMLInputElement>('#cloud-code')!;expect(code.autocomplete).toBe('one-time-code');expect(code.inputMode).toBe('numeric');expect(code.pattern).toBe('[0-9]{6}');expect(code.getAttribute('data-blok-field')).toBe('text');
  });
  it('opens the actual workspace only on explicit selection', async () => {
    const open = vi.fn(); vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/api/session') ? {user,workspaces:[workspace]} : {...workspace,joinStatus:'approved'})));
    await mountCloudGateway(document.body,{onOpenWorkspace:open}); expect(open).not.toHaveBeenCalled();
    click('Ouvrir l’espace'); await settle(); expect(open).toHaveBeenCalledWith(workspace, expect.any(CloudClient));
  });
  it('approves a pending request through the API and reloads administration', async () => {
    let pending = true;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/session')) return response({user,workspaces:[workspace]});
      if (url.endsWith('/approve')) {expect(init?.method).toBe('POST'); expect(JSON.parse(init?.body as string)).toEqual({role:'member'}); pending = false; return response({ok:true});}
      if (url.endsWith('/members')) return response({members:[{...user,role:'admin'}]});
      if (url.endsWith('/join-requests')) return response({requests:pending ? [{id:'r1',email:'bob@example.com',status:'pending',message:'Bonjour'}] : []});
      if (url.endsWith('/invites')) return response({invites:[]});
      return response({...workspace,joinStatus:'approved'});
    });
    vi.stubGlobal('fetch', fetch); await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()}); click('Gérer'); await settle();
    expect(document.body.textContent).toContain('bob@example.com'); click('Accepter'); await settle();
    expect(document.body.textContent).toContain('Aucune demande en attente.'); expect(pending).toBe(false);
  });
  it('keeps a refused admin operation visible and reports the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/session')) return response({user,workspaces:[workspace]});
      if (url.endsWith('/reject')) return response({error:'Accès refusé'},403);
      if (url.endsWith('/members')) return response({members:[]});
      if (url.endsWith('/join-requests')) return response({requests:[{id:'r1',email:'bob@example.com',status:'pending'}]});
      if (url.endsWith('/invites')) return response({invites:[]});
      return response({...workspace,joinStatus:'approved'});
    }));
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()}); click('Gérer'); await settle(); click('Refuser'); await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Accès refusé'); expect(document.body.textContent).toContain('bob@example.com');
  });
});
describe('cloud account and server selection', () => {
  it('revokes the current session before switching accounts', async () => {
    const fetch = vi.fn(async (url: string) => response(url.endsWith('/api/session') ? {user,workspaces:[workspace]} : {...workspace,joinStatus:'approved'}));
    vi.stubGlobal('fetch',fetch);
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn()}); click('Changer de compte'); await settle();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/api/auth/logout'))).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe('');
    expect(document.body.textContent).not.toContain(user.email);
  });
  it('prefills the server origin and normalizes a new HTTPS server', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => response({error:'Unauthorized'},401)));
    const change = vi.fn(); await mountCloudGateway(document.body,{apiOrigin:'https://current.example.test',onOpenWorkspace:vi.fn(),onServerChange:change});
    const input = document.querySelector<HTMLInputElement>('#cloud-server')!;
    expect(input.value).toBe('https://current.example.test'); input.value = 'https://new.example.test/path';
    input.form!.dispatchEvent(new Event('submit',{cancelable:true})); await settle(); expect(change).toHaveBeenCalledWith('https://new.example.test');
  });
  it('rejects a credentialed server without changing the connection', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => response({error:'Unauthorized'},401)));
    const change = vi.fn(); await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),onServerChange:change});
    const input = document.querySelector<HTMLInputElement>('#cloud-server')!; input.value = 'https://alice:secret@example.test';
    input.form!.dispatchEvent(new Event('submit',{cancelable:true})); await settle(); expect(change).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('sans identifiants');
  });
});
describe('direct workspace administration', () => {
  function authenticatedAdmin() {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/session')) return response({user,workspaces:[workspace]});
      if (url.endsWith('/members')) return response({members:[{...user,role:'admin'}]});
      if (url.endsWith('/join-requests')) return response({requests:[]});
      if (url.endsWith('/invites')) return response({invites:[]});
      return response({...workspace,joinStatus:'approved'});
    }); vi.stubGlobal('fetch',fetch); return fetch;
  }
  it('opens administration directly and focuses the requested invitation field', async () => {
    authenticatedAdmin(); const open = vi.fn();
    await mountCloudGateway(document.body,{onOpenWorkspace:open,initialManage:{slug:workspace.slug,section:'invites'}});
    expect(document.body.textContent).toContain('Gérez les accès à cet espace de travail.');
    expect(document.activeElement?.getAttribute('id')).toBe('cloud-invite-email');
    expect(document.body.textContent).not.toContain('Où souhaitez-vous travailler ?');
    click('Ouvrir l’espace'); await settle(); expect(open).toHaveBeenCalledWith(workspace,expect.any(CloudClient));
  });
  it('supports member settings focus and returning to the workspace selector', async () => {
    authenticatedAdmin();
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),initialManage:{slug:workspace.slug,section:'members'}});
    expect(document.activeElement?.textContent).toBe('Membres · 1');
    click('← Tous les espaces'); await settle(); expect(document.body.textContent).toContain('Où souhaitez-vous travailler ?');
  });
  it.each(['member','viewer','missing'])('falls back to the selector for an unauthorized %s route', async role => {
    const fetch = vi.fn(async (url: string) => response(url.endsWith('/api/session') ? {user,workspaces:role === 'missing' ? [] : [{...workspace,role}]} : {...workspace,role:role === 'missing' ? null : role,joinStatus:null}));
    vi.stubGlobal('fetch',fetch);
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),initialManage:{slug:workspace.slug,section:'invites'}});
    expect(document.body.textContent).toContain('Où souhaitez-vous travailler ?');
    expect(fetch.mock.calls.some(([url]) => /\/(members|invites|join-requests)$/.test(url))).toBe(false);
  });
  it('returns to the selector when administration permission is revoked during loading', async () => {
    vi.stubGlobal('fetch',vi.fn(async (url: string) => {
      if (url.endsWith('/api/session')) return response({user,workspaces:[workspace]});
      if (/\/(members|invites|join-requests)$/.test(url)) return response({error:'Administrator required'},403);
      return response({...workspace,role:'member',joinStatus:'approved'});
    }));
    await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),initialManage:{slug:workspace.slug}});
    expect(document.body.textContent).toContain('Où souhaitez-vous travailler ?');
    expect(document.querySelector('input[type="email"]')).toBeNull();
  });
  it.each([false,true])('hides local workspace actions when disabled (authenticated %s)', async authenticated => {
    vi.stubGlobal('fetch',vi.fn(async (url: string) => authenticated ? response(url.endsWith('/api/session') ? {user,workspaces:[workspace]} : {...workspace,joinStatus:'approved'}) : response({error:'Unauthorized'},401)));
    const local = vi.fn(); await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),onOpenLocal:local,allowLocal:false});
    expect(document.body.textContent).not.toContain('espace local'); expect(local).not.toHaveBeenCalled();
  });
  it('retains native local workspace access when explicitly enabled', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => response({error:'Unauthorized'},401)));
    const local = vi.fn(); await mountCloudGateway(document.body,{onOpenWorkspace:vi.fn(),onOpenLocal:local,allowLocal:true});
    click('Continuer avec un espace local'); await settle(); expect(local).toHaveBeenCalledOnce();
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
