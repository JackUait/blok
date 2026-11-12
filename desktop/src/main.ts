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

async function boot(root: HTMLElement): Promise<void> {
  applyAppearance(root, readAppearance());
  const params = new URLSearchParams(location.search);
  const selected = activeWorkspace();
  const explicitGateway = params.get('cloud') === '1';
  const origin = serverOrigin(native ? params.get('server') ?? (selected.kind === 'remote' ? selected.server : 'https://blok.tousamba.cloud') : location.origin);
  const adapter = native ? nativeSessionAdapter(origin) : undefined;
  const client = new CloudClient({origin, sessionAdapter: adapter});

  const showGateway = async (): Promise<void> => {
    document.title = 'Tousambassadeurs — Connexion';
    await mountCloudGateway(root, {
      apiOrigin: origin,
      sessionAdapter: adapter,
      allowLocal: native,
      initialManage: params.has('manage') ? {
        slug: params.get('manage')!,
        section: params.get('section') === 'invites' ? 'invites' : 'members',
      } : undefined,
      onOpenWorkspace: async (workspace, source) => {
        const session = source.currentSession ?? await source.session();
        const ref: RemoteWorkspace = {
          kind: 'remote', id: workspace.id, name: workspace.name,
          server: serverOrigin(source.origin || location.origin), accountId: session.user.id,
          workspaceId: workspace.slug, userName: session.user.email, role: workspace.role,
        };
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
  if (selected.kind === 'remote') {
    try {
      const session = await client.session();
      const membership = session.workspaces.find(item => item.slug === selected.workspaceId);
      if (session.user.id !== selected.accountId || !membership || selected.server !== origin) {
        await showGateway();
        return;
      }
      rememberWorkspace({...selected, role: membership.role, name: membership.name});
    } catch {
      await showGateway();
      return;
    }
  }
  const {mountDesktop, flushDesktop} = await import('./shell');
  root.addEventListener('blok:desktop-connect-cloud', (event) => {
    void flushDesktop().then(() => {
      const url = new URL(location.href);
      url.searchParams.set('cloud', '1');
      url.searchParams.delete('page');
      url.searchParams.delete('manage');
      url.searchParams.delete('section');
      const section = (event as CustomEvent<{section?: string}>).detail?.section;
      if (selected.kind === 'remote' && (section === 'settings' || section === 'invites' || section === 'members')) {
        url.searchParams.set('manage', selected.workspaceId);
        url.searchParams.set('section', section === 'invites' ? 'invites' : 'members');
      }
      location.assign(url.href);
    }).catch(showError);
  });
  mountDesktop(root);
}
function showError(error: unknown): void {
  if (!(root instanceof HTMLElement)) return;
  let message = root.querySelector<HTMLElement>('[data-startup-error]');
  if (!message) {
    message = document.createElement('p');
    message.setAttribute('data-startup-error', '');
    message.setAttribute('role', 'alert');
    root.append(message);
  }
  message.textContent = error instanceof Error ? error.message : 'Impossible d’ouvrir cet espace. Rechargez pour réessayer.';
}
if (root instanceof HTMLElement) void boot(root).catch(showError);
