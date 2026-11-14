import './editor.css';
import '../../src/shell/sidebar.css';
import './shell.css';
import { activeWorkspace, initialWorkspace, rememberWorkspace, selectWorkspace, serverOrigin, type RemoteWorkspace } from './workspace-registry';
import { nativeSessionAdapter } from './native-session';
import { applyAppearance, readAppearance } from './settings';
import { CloudClient, mountCloudGateway } from './cloud';

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
    document.title = 'Connexion';
    await mountCloudGateway(root, {
      apiOrigin: origin || undefined,
      sessionAdapter: adapter,
      allowLocal: native,
      initialManage: manageSlug && manageSection ? {slug: manageSlug, section: manageSection} : undefined,
      onOpenWorkspace: async (workspace, source) => {
        const session = source.currentSession ?? await source.session();
        const ref: RemoteWorkspace = {
          kind: 'remote', id: workspace.id, name: workspace.name,
          server: serverOrigin(source.origin || location.origin), accountId: session.user.id,
          workspaceId: workspace.slug, userName: session.user.email, role: workspace.role,
        };
        // ?manage= opens the workspace then the settings modal (admin screen removed).
        if (manageSlug && manageSection && workspace.slug === manageSlug) {
          sessionStorage.setItem('blok:desktop:pending-settings', manageSection);
        }
        selectWorkspace(ref);
      },
      onOpenLocal: () => selectWorkspace(selected.kind === 'local' ? selected : initialWorkspace),
      onServerChange: (server) => {
        if (!native) {
          location.assign(serverOrigin(server));
          return;
        }
        const url = new URL(location.href);
        url.searchParams.set('server', serverOrigin(server));
        url.searchParams.set('cloud', '1');
        url.searchParams.delete('page');
        location.assign(url.href);
      },
    });
  };

  if (explicitGateway || (!native && selected.kind === 'local' && params.get('local') !== '1')) {
    await showGateway();
    return;
  }
  if (selected.kind === 'remote' && !(await refreshRemoteMembership(client, selected, origin, showGateway))) {
    return;
  }
  const {mountDesktop, flushDesktop} = await import('./shell');
  root.addEventListener('blok:desktop-connect-cloud', (event) => {
    const section = (event as CustomEvent<{section?: string}>).detail?.section;
    // Already inside a remote workspace: open settings in place instead of the old gateway admin screen.
    if (selected.kind === 'remote' && (section === 'settings' || section === 'invites' || section === 'members')) {
      const footer = root.querySelector('[data-desktop-footer]');
      footer?.dispatchEvent(new CustomEvent('blok:desktop-open-settings', {
        detail: settingsOpenDetail(section),
      }));
      return;
    }
    void flushDesktop().then(() => {
      const url = new URL(location.href);
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
    rememberWorkspace({...selected, role: membership.role, name: membership.name});
    return true;
  } catch {
    await showGateway();
    return false;
  }
}

function showError(error: unknown): void {
  if (!(root instanceof HTMLElement)) return;
  const message = startupErrorNode(root);
  message.textContent = error instanceof Error ? error.message : 'Impossible d’ouvrir cet espace. Rechargez pour réessayer.';
}
if (root instanceof HTMLElement) void boot(root).catch(showError);
