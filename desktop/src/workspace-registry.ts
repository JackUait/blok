import { workspaceSwitchUrl } from './page-urls';
/** Non-secret workspace references. Session credentials live in the OS keychain. */
export type LocalWorkspace = { kind: 'local'; id: string; name: string; icon?: string | null };
export type RemoteWorkspace = { kind: 'remote'; id: string; name: string; server: string; accountId: string; workspaceId: string; icon?: string | null; userName?: string; role?: 'admin' | 'member' | 'viewer' };
export type WorkspaceRef = LocalWorkspace | RemoteWorkspace;
const KEY = 'blok:desktop:workspaces:v1';
const ACTIVE = 'blok:desktop:active-workspace:v1';
export const initialWorkspace: LocalWorkspace = { kind: 'local', id: 'default', name: 'Espace local' };
export function serverOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Le serveur doit utiliser HTTPS');
  if (url.username || url.password) throw new Error('Adresse du serveur invalide');
  return url.origin;
}
export function workspaceKey(ref: WorkspaceRef): string {
  return ref.kind === 'local' ? `local:${ref.id}` : JSON.stringify(['remote', serverOrigin(ref.server), ref.accountId, ref.workspaceId]);
}
export function listWorkspaces(): WorkspaceRef[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(data)) return [initialWorkspace];
    const refs = data.filter((item): item is WorkspaceRef => {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') return false;
      if (item.kind === 'local') return /^[a-zA-Z0-9-]+$/.test(item.id);
      try { return item.kind === 'remote' && typeof item.accountId === 'string' && typeof item.workspaceId === 'string' && serverOrigin(item.server) === item.server; } catch { return false; }
    });
    const savedDefault = refs.find((item) => workspaceKey(item) === workspaceKey(initialWorkspace));
    const defaultWorkspace = savedDefault ?? {...initialWorkspace, name: localStorage.getItem('blok:desktop:profile-name') || initialWorkspace.name};
    return [defaultWorkspace, ...refs.filter((item) => workspaceKey(item) !== workspaceKey(initialWorkspace))];
  } catch { return [initialWorkspace]; }
}
export function activeWorkspace(): WorkspaceRef {
  const workspaces = listWorkspaces();
  return workspaces.find((item) => workspaceKey(item) === localStorage.getItem(ACTIVE))
    ?? workspaces.find((item) => workspaceKey(item) === workspaceKey(initialWorkspace))
    ?? initialWorkspace;
}
export function rememberWorkspace(ref: WorkspaceRef): void {
  const all = listWorkspaces().filter((item) => workspaceKey(item) !== workspaceKey(ref));
  localStorage.setItem(KEY, JSON.stringify([...all, ref]));
}
export function createLocalWorkspace(name: string): LocalWorkspace {
  const ref: LocalWorkspace = { kind: 'local', id: crypto.randomUUID(), name: name.trim().slice(0, 80) || 'Nouvel espace local' };
  rememberWorkspace(ref);
  return ref;
}
/** Call only after the current editor has flushed; reload removes all old listeners and timers. */
export function activateWorkspace(ref:WorkspaceRef):void {
  rememberWorkspace(ref);localStorage.setItem(ACTIVE,workspaceKey(ref));
}
export function selectWorkspace(ref: WorkspaceRef, options:{resumePage?:boolean} = {}): void {
  rememberWorkspace(ref);
  localStorage.setItem(ACTIVE, workspaceKey(ref));
  const sameOrigin=ref.kind==='local' || '__TAURI_INTERNALS__' in window || ref.server===location.origin;
  const base=sameOrigin ? location.href : `${ref.server}/`;
  location.assign(workspaceSwitchUrl(base,ref.kind==='local',sameOrigin && options.resumePage));
}
