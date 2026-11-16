import { cacheAccountProfile } from './account-profile';
import './editor.css';
import '../../src/shell/sidebar.css';
import './shell.css';
import { activeWorkspace, activateWorkspace, initialWorkspace, rememberWorkspace, selectWorkspace, serverOrigin, type RemoteWorkspace } from './workspace-registry';
import { nativeSessionAdapter } from './native-session';
import { applyAppearance, readAppearance } from './settings';
import { CloudClient, mountCloudGateway } from './cloud';
import { pageDestination, resolvePageDestination, publicPageUrl, legacyPageUrl, rememberPageLinks } from './page-urls';
import { brandedTitle } from './tab-identity';

import {loadReactGrab, reactGrabAvailable} from './react-grab';

if (reactGrabAvailable) void loadReactGrab().catch(() => { /* Settings lets the user retry loading. */ });

const root = document.querySelector('#app');
const native = '__TAURI_INTERNALS__' in window;

function manageSectionFromParams(params: URLSearchParams): 'invites' | 'members' | undefined {
  if (!params.get('manage')) return undefined;
  return params.get('section') === 'invites' ? 'invites' : 'members';
}

function settingsOpenDetail(section: string): 'invites' | 'members' | 'general' {
  if (section === 'invites') return 'invites';
  if (section === 'members') return 'members';
  return 'general';
}

function startupErrorNode(host: HTMLElement): HTMLElement {
  const existing = host.querySelector<HTMLElement>('[data-startup-error]');
  if (existing) return existing;
  const message = document.createElement('p');
  message.setAttribute('data-startup-error', '');
  message.setAttribute('role', 'alert');
  host.append(message);
  return message;
}

async function boot(root: HTMLElement): Promise<void> {
  applyAppearance(root, readAppearance());
  const params = new URLSearchParams(location.search);
  const selected = activeWorkspace();
  const explicitGateway = params.get('cloud') === '1';
  const configured = native
    ? params.get('server') ?? (selected.kind === 'remote' ? selected.server : '')
    : location.origin;
  const origin = configured ? serverOrigin(configured) : '';
  const adapter = native && origin ? nativeSessionAdapter(origin) : undefined;
  const client = new CloudClient({origin, sessionAdapter: adapter});
  const manageSlug = params.get('manage');
  const manageSection = manageSectionFromParams(params);

  const showGateway = async (): Promise<void> => {
    document.title = brandedTitle('Connexion');
    await mountCloudGateway(root, {
      apiOrigin: origin || undefined,
      sessionAdapter: adapter,
      allowLocal: native,
      forceWorkspacePicker: explicitGateway,
      initialManage: manageSlug && manageSection ? {slug: manageSlug, section: manageSection} : undefined,
      onOpenWorkspace: async (workspace, source) => {
        const session = source.currentSession ?? await source.session();
        const ref: RemoteWorkspace = {
          kind: 'remote', id: workspace.id, name: workspace.name, icon: workspace.icon ?? null,
          server: serverOrigin(source.origin || location.origin), accountId: session.user.id,
          workspaceId: workspace.slug, userName: session.user.email, role: workspace.role,
        };
        cacheAccountProfile(ref, session.user);
        // ?manage= opens the workspace then the settings modal (admin screen removed).
        if (manageSlug && manageSection && workspace.slug === manageSlug) {
          sessionStorage.setItem('blok:desktop:pending-settings', manageSection);
        }
        selectWorkspace(ref, {resumePage:pageDestination(location.href).kind!=='none'});
      },
      onOpenLocal: () => selectWorkspace(selected.kind === 'local' ? selected : initialWorkspace),
      onServerChange: (server) => {
        if (!native) {
          location.assign(serverOrigin(server));
          return;
        }
        const url = new URL(location.href);
        url.pathname='/';
        url.searchParams.set('server', serverOrigin(server));
        url.searchParams.set('cloud', '1');
        url.searchParams.delete('page');
        location.assign(url.href);
      },
    });
  };

  const destination=pageDestination(location.href);
  const remoteDestination=destination.kind!=='none' && (destination.kind!=='legacy' || (native ? selected.kind==='remote' : params.get('local')!=='1'));
  if(remoteDestination && !explicitGateway){
    if(destination.kind==='invalid'){showUnavailable(root);return;}
    const session=await client.session().catch(error=>{if(error && typeof error==='object' && 'status' in error && error.status===401)return null;throw error;});
    if(!session){await showGateway();return;}
    try{
      const resolved=await resolvePageDestination(client,location.href,session);
      const ref:RemoteWorkspace={kind:'remote',id:resolved.workspace.id,name:resolved.workspace.name,icon:resolved.workspace.icon ?? null,server:origin,workspaceId:resolved.workspace.slug,accountId:session.user.id,userName:session.user.email,role:resolved.workspace.role};
      cacheAccountProfile(ref, session.user);
      activateWorkspace(ref);
      rememberPageLinks(location.origin,origin,[{id:resolved.pageId,title:resolved.title,publicId:resolved.publicId}]);
      const url=native ? legacyPageUrl(location.href,resolved.pageId) : publicPageUrl(origin,resolved.title,resolved.publicId);
      history.replaceState(null,'',url);
    }catch{showUnavailable(root);return;}
  }else{
    if (explicitGateway || (!native && selected.kind === 'local' && params.get('local') !== '1')) {await showGateway();return;}
    if (selected.kind === 'remote' && !(await refreshRemoteMembership(client, selected, origin, showGateway))) return;
  }
  const {mountDesktop, flushDesktop} = await import('./shell');
  const mountedWorkspace=activeWorkspace();
  root.addEventListener('blok:desktop-connect-cloud', (event) => {
    const section = (event as CustomEvent<{section?: string}>).detail?.section;
    // Already inside a remote workspace: open settings in place instead of the old gateway admin screen.
    if (mountedWorkspace.kind === 'remote' && (section === 'settings' || section === 'invites' || section === 'members')) {
      const footer = root.querySelector('[data-desktop-footer]');
      footer?.dispatchEvent(new CustomEvent('blok:desktop-open-settings', {
        detail: settingsOpenDetail(section),
      }));
      return;
    }
    void flushDesktop().then(() => {
      const url = new URL(location.href);
      url.pathname='/';
      url.searchParams.set('cloud', '1');
      url.searchParams.delete('page');
      url.searchParams.delete('manage');
      url.searchParams.delete('section');
      location.assign(url.href);
    }).catch(showError);
  });
  mountDesktop(root);
}

async function refreshRemoteMembership(
  client: CloudClient,
  selected: Extract<ReturnType<typeof activeWorkspace>, { kind: 'remote' }>,
  origin: string,
  showGateway: () => Promise<void>,
): Promise<boolean> {
  try {
    const session = await client.session();
    const membership = session.workspaces.find(item => item.slug === selected.workspaceId);
    if (session.user.id !== selected.accountId || !membership || selected.server !== origin) {
      await showGateway();
      return false;
    }
    cacheAccountProfile(selected, session.user);
    rememberWorkspace({...selected, role: membership.role, name: membership.name, icon: membership.icon ?? null});
    return true;
  } catch {
    await showGateway();
    return false;
  }
}

function showUnavailable(host:HTMLElement):void {
  document.title=brandedTitle('Page indisponible');
  const section=document.createElement('section');section.setAttribute('data-page-unavailable','');section.style.padding='48px';
  const title=document.createElement('h1');title.textContent='Page indisponible';
  const copy=document.createElement('p');copy.textContent='Cette page est introuvable ou vous n’y avez pas accès avec ce compte.';
  const back=document.createElement('a');back.href='/';back.textContent='Retour aux Workspaces';
  section.append(title,copy,back);host.replaceChildren(section);
}

function showError(error: unknown): void {
  if (!(root instanceof HTMLElement)) return;
  const message = startupErrorNode(root);
  message.textContent = error instanceof Error ? error.message : 'Impossible d’ouvrir cet espace. Rechargez pour réessayer.';
}
if (root instanceof HTMLElement) void boot(root).catch(showError);
