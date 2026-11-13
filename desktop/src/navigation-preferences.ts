import { workspaceKey, type WorkspaceRef } from './workspace-registry';

export function navigationRecents(ref: WorkspaceRef): { ids: string[]; save(ids: string[]): void } {
  const key = `blok:navigation:recents:${workspaceKey(ref)}`;
  let ids: string[] = [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(value)) ids = [...new Set(value.filter((id): id is string => typeof id === 'string'))].slice(0, 50);
  } catch { /* Keep navigation usable without storage. */ }
  return { ids, save(next) { try { localStorage.setItem(key, JSON.stringify(next.slice(0, 50))); } catch { /* Session only. */ } } };
}

/** Personal navigation only: never writes shared document metadata. */
export function navigationFavorites(ref: WorkspaceRef): { has(id: string): boolean; set(id: string, favorite: boolean): void } {
  const key = `blok:navigation:favorites:${workspaceKey(ref)}`;
  let ids = new Set<string>();
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(value)) ids = new Set(value.filter((id): id is string => typeof id === 'string'));
  } catch { /* Storage can be unavailable in a private session. */ }
  return {
    has: (id) => ids.has(id),
    set(id, favorite) {
      if (favorite) ids.add(id); else ids.delete(id);
      try { localStorage.setItem(key, JSON.stringify([...ids])); } catch { /* Keep this session usable. */ }
    },
  };
}
