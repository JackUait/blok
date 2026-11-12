import { mergeWorkspaceIndex } from './workspace-merge';
import { loadIndex, readFile, writeFile, type WorkspaceIndex } from './storage';
import { nativeSessionAdapter } from './native-session';
import type { WorkspaceRef } from './workspace-registry';
class RepositoryHttpError extends Error { constructor(public status: number) { super(`Serveur indisponible (${status})`); } }
const snapshot = (index: WorkspaceIndex): WorkspaceIndex => JSON.parse(JSON.stringify(index)) as WorkspaceIndex;
/** A repository owns one immutable identity, including all queued writes. */
export function workspaceRepository(workspace: WorkspaceRef) {
  const ref = Object.freeze({...workspace});
  let revision: number | null = null;
  let baseline: WorkspaceIndex | null = null;
  let acknowledged: WorkspaceIndex | null = null;
  const pageWrites = new Map<string, Promise<void>>();
  const base = ref.kind === 'remote' ? `${ref.server}/api/workspaces/${encodeURIComponent(ref.workspaceId)}` : '';
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const token = ref.kind === 'remote' && '__TAURI_INTERNALS__' in window ? await nativeSessionAdapter(ref.server).getToken() : null;
    const response = await fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
    if (!response.ok) throw new RepositoryHttpError(response.status);
    return await response.json() as T;
  }
  return {
    ref,
    async loadIndex(): Promise<WorkspaceIndex> {
      if (ref.kind === 'local') return loadIndex(ref);
      const value = await request<WorkspaceIndex & { revision: number }>(`${base}/index`);
      revision = value.revision;
      const index = { pages: value.pages, trash: value.trash ?? [], activeId: value.pages[0]?.id ?? '' };
      baseline = snapshot(index); acknowledged = snapshot(index);
      return index;
    },
    async refreshIndex(accept: () => boolean): Promise<WorkspaceIndex | null> {
      if (ref.kind !== 'remote') return null;
      const value = await request<WorkspaceIndex & {revision: number}>(`${base}/index`);
      if (!accept()) return null;
      revision = value.revision;
      const index = {pages:value.pages,trash:value.trash ?? [],activeId:value.pages[0]?.id ?? ''};
      baseline = snapshot(index); acknowledged = snapshot(index);
      return index;
    },
    async saveIndex(value: WorkspaceIndex): Promise<WorkspaceIndex> {
      if (ref.kind === 'local') { await writeFile('index', JSON.stringify(value), ref); return value; }
      if (revision === null || !baseline || !acknowledged) throw new Error('L’espace doit être chargé avant son enregistrement');
      const intent = snapshot(value);
      let merged = mergeWorkspaceIndex(baseline, intent, acknowledged);
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const next = await request<{ revision: number }>(`${base}/index`, { method: 'PUT', body: JSON.stringify({ pages: merged.pages, trash: merged.trash ?? [], revision }) });
          revision = next.revision;
          baseline = intent; acknowledged = snapshot(merged);
          return merged;
        } catch (error) {
          if (!(error instanceof RepositoryHttpError) || error.status !== 409 || attempt === 3) throw error;
          const fresh = await request<WorkspaceIndex & {revision: number}>(`${base}/index`);
          revision = fresh.revision;
          acknowledged = {pages:fresh.pages,trash:fresh.trash ?? [],activeId:fresh.pages[0]?.id ?? ''};
          merged = mergeWorkspaceIndex(baseline, intent, acknowledged);
        }
      }
      throw new Error('L’espace change trop rapidement. Réessayez.');
    },
    readPage(id: string) {
      if (ref.kind !== 'local') throw new Error('Remote documents require collaboration');
      return (pageWrites.get(id) ?? Promise.resolve()).then(() => readFile(id, ref));
    },
    writePage(id: string, data: string) {
      if (ref.kind !== 'local') throw new Error('Remote documents require collaboration');
      const pending = (pageWrites.get(id) ?? Promise.resolve()).then(() => writeFile(id, data, ref));
      pageWrites.set(id, pending);
      return pending;
    },
    async seedPage(id: string, document: unknown): Promise<void> {
      if (ref.kind !== 'remote') throw new Error('Remote operation only');
      await request(`${base}/pages/${encodeURIComponent(id)}/seed`, {method: 'POST', body: JSON.stringify({document})});
    },
    async duplicatePage(source: string, page: {id: string; title: string; parentId: string | null}): Promise<void> {
      if (ref.kind !== 'remote') throw new Error('Remote operation only');
      await request(`${base}/pages/${encodeURIComponent(source)}/duplicate`, {method: 'POST', body: JSON.stringify(page)});
    },
    async uploadImage(dataUrl: string): Promise<string> {
      if (ref.kind === 'local') return dataUrl;
      const image = await request<{url: string}>(`${base}/images`, {method: 'POST', body: JSON.stringify({dataUrl})});
      return new URL(image.url, ref.server).href;
    },
    async assetUrl(url: string): Promise<string> {
      if (ref.kind !== 'remote') return url;
      const asset = new URL(url, ref.server);
      if (asset.origin !== ref.server || !asset.pathname.startsWith('/files/')) return url;
      return (await request<{url: string}>(`${ref.server}/api/assets/url?url=${encodeURIComponent(asset.href)}`)).url;
    },
    async ticket(doc: string): Promise<string> { return (await request<{ticket: string}>(`${base}/ticket?doc=${encodeURIComponent(doc)}`)).ticket; },
  };
}
