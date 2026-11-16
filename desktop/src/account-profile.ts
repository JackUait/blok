import type { CloudClient, CloudUser } from './cloud/client';
import { serverOrigin, type RemoteWorkspace } from './workspace-registry';
import { PROFILE_CHANGED, mountProfileEditor, type LocalProfile } from './local-profile';

const PREFIX = 'blok:desktop:account-profile:v1:';
const profiles = new Map<string, CloudUser>();
const keyOf = (ref: RemoteWorkspace): string => PREFIX + JSON.stringify([serverOrigin(ref.server), ref.accountId]);
window.addEventListener('storage', event => {
  if (event.key === null) profiles.clear();
  else if (event.key.startsWith(PREFIX)) profiles.delete(event.key);
});
export function readAccountProfile(ref: RemoteWorkspace): CloudUser | undefined {
  const key = keyOf(ref);
  if (profiles.has(key)) return profiles.get(key);
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as CloudUser | null;
    if (value?.id === ref.accountId && typeof value.email === 'string' && (value.name === undefined || typeof value.name === 'string') && (value.avatarUrl === undefined || typeof value.avatarUrl === 'string')) { profiles.set(key, value); return value; }
  } catch { /* Offline without a cached profile: the workspace still carries its email. */ }
  return undefined;
}
export function cacheAccountProfile(ref: RemoteWorkspace, user: CloudUser): void {
  if (user.id !== ref.accountId) throw new Error('Le compte connecté a changé. Reconnectez-vous.');
  const key = keyOf(ref); profiles.set(key, user);
  try { localStorage.setItem(key, JSON.stringify(user)); } catch { /* The server remains authoritative; keep this session usable. */ }
  window.dispatchEvent(new Event(PROFILE_CHANGED));
}

export function mountAccountProfile(host: HTMLElement, client: CloudClient, ref: RemoteWorkspace, onSaved: (user: CloudUser) => void): { destroy(): void } {
  let disposed = false; let editor: { destroy(): void } | undefined;
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Chargement du profil…';
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Réessayer'; retry.hidden = true;
  host.append(status, retry);
  const load = async (): Promise<void> => {
    retry.hidden = true; status.textContent = 'Chargement du profil…';
    try {
      const { user } = await client.session();
      if (disposed) return;
      cacheAccountProfile(ref, user); onSaved(user);
      let profile: LocalProfile = { name: user.name ?? '', photo: user.avatarUrl || null };
      status.textContent = '';
      editor = mountProfileEditor(host, {
        read: () => profile,
        async save(value) {
          const updated = await client.updateProfile({ name: value.name.trim(), avatarUrl: value.photo });
          cacheAccountProfile(ref, updated);
          profile = { name: updated.name ?? '', photo: updated.avatarUrl || null };
          if (!disposed) onSaved(updated);
        },
      });
    } catch (error) {
      if (disposed) return;
      status.textContent = error instanceof Error ? error.message : 'Profil indisponible.'; retry.hidden = false;
    }
  };
  retry.addEventListener('click', () => { void load(); }); void load();
  return { destroy() { disposed = true; editor?.destroy(); status.remove(); retry.remove(); } };
}
