import { activeWorkspace, type WorkspaceRef } from './workspace-registry';
import type { ShellPage } from '@blok/sidebar';
import type { PageCover } from './cover';
import type { DateDisplay } from '@blok/date-editor';
import type { PageAccessMap } from './page-access';

export type DesktopPage = ShellPage & { initialVisibility?: 'private'; cover?: PageCover; coverPosition?: number; fullWidth?: boolean; titleDate?: string; titleDateDisplay?: DateDisplay; titleDateSuffix?: string };

export interface WorkspaceIndex {
  pages: DesktopPage[];
  activeId: string;
  trash?: DesktopPage[];
  /** Niveau du compte sur chaque page, tel que le serveur l'annonce. Absent hors ligne. */
  access?: PageAccessMap;
}

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
};

function native(): TauriWindow['__TAURI_INTERNALS__'] {
  return (window as TauriWindow).__TAURI_INTERNALS__;
}

/**
 * Thrown when the file changed on disk since this window read it. The save is
 * refused rather than applied: whatever wrote in between — an agent over MCP,
 * another window, a sync tool — keeps its work.
 */
export class StaleFileError extends Error {
  public constructor(public readonly name_: string) {
    super(`Le fichier « ${name_} » a changé depuis sa lecture ; la sauvegarde est refusée.`);
    this.name = 'StaleFileError';
  }
}

/** Fingerprint of the bytes this window last saw for a file, by name. */
const seen = new Map<string, string>();

async function fingerprint(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readFile(name: string, workspace: WorkspaceRef = activeWorkspace()): Promise<string | null> {
  if (workspace.kind !== 'local') throw new Error('Remote documents require collaboration; local storage is forbidden');
  const scope = workspace.id === 'default' ? {} : { workspace: workspace.id };
  const key = `${workspace.id}:${name}`;
  const bridge = native();
  if (bridge) {
    const data = await bridge.invoke('load_workspace_file', { name, ...scope }) as string | null;
    seen.set(key, await fingerprint(data ?? ''));
    return data;
  }
  return localStorage.getItem(workspace.id === 'default' ? `blok:workspace:${name}` : `blok:workspace:${workspace.id}:${name}`);
}

export async function writeFile(name: string, data: string, workspace: WorkspaceRef = activeWorkspace()): Promise<void> {
  if (workspace.kind !== 'local') throw new Error('Remote documents require collaboration; local storage is forbidden');
  const scope = workspace.id === 'default' ? {} : { workspace: workspace.id };
  const key = `${workspace.id}:${name}`;
  const bridge = native();
  if (bridge) {
    // A file this window never read carries no fingerprint, so creating one still works.
    const expected = seen.get(key);
    try {
      await bridge.invoke('save_workspace_file', expected === undefined ? { name, data, ...scope } : { name, data, expected, ...scope });
    } catch (error) {
      if (String((error as Error)?.message ?? error).includes('stale')) throw new StaleFileError(name);
      throw error;
    }
    seen.set(key, await fingerprint(data));
    return;
  }
  localStorage.setItem(workspace.id === 'default' ? `blok:workspace:${name}` : `blok:workspace:${workspace.id}:${name}`, data);
}

export async function dataDirectory(workspace: WorkspaceRef = activeWorkspace()): Promise<string> {
  if (workspace.kind === 'remote') return `${workspace.server} · ${workspace.name}`;
  const bridge = native();
  if (bridge) return await bridge.invoke('workspace_data_directory', workspace.id === 'default' ? undefined : { workspace: workspace.id }) as string;
  return 'Navigateur local (localStorage)';
}

export async function loadIndex(workspace: WorkspaceRef = activeWorkspace()): Promise<WorkspaceIndex> {
  const raw = await readFile('index', workspace);
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && 'pages' in value && Array.isArray(value.pages)) {
        const pages = value.pages.filter((page): page is ShellPage =>
          !!page && typeof page.id === 'string' && typeof page.title === 'string' &&
          (page.parentId === null || typeof page.parentId === 'string'));
        if (pages.length) {
          const activeId = 'activeId' in value && typeof value.activeId === 'string' &&
            pages.some((page) => page.id === value.activeId) ? value.activeId : pages[0]!.id;
          const trash = 'trash' in value && Array.isArray(value.trash)
            ? value.trash.filter((page): page is ShellPage => !!page && typeof page.id === 'string' && typeof page.title === 'string')
            : [];
          return { pages, activeId, trash };
        }
      }
    } catch { /* Recover from a damaged index with a new empty page. */ }
  }
  const id = crypto.randomUUID();
  const index = { pages: [{ id, title: 'Nouvelle page', parentId: null }], activeId: id, trash: [] };
  await saveIndex(index, workspace);
  return index;
}

export async function saveIndex(index: WorkspaceIndex, workspace: WorkspaceRef = activeWorkspace()): Promise<void> {
  await writeFile('index', JSON.stringify(index), workspace);
}
