import type { ShellPage } from '@blok/sidebar';
import type { CoverId } from './cover';

export type DesktopPage = ShellPage & { cover?: CoverId; coverPosition?: number; fullWidth?: boolean };

export interface WorkspaceIndex {
  pages: DesktopPage[];
  activeId: string;
  trash?: DesktopPage[];
}

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
};

function native(): TauriWindow['__TAURI_INTERNALS__'] {
  return (window as TauriWindow).__TAURI_INTERNALS__;
}

export async function readFile(name: string): Promise<string | null> {
  const bridge = native();
  if (bridge) return await bridge.invoke('load_workspace_file', { name }) as string | null;
  return localStorage.getItem(`blok:workspace:${name}`);
}

export async function writeFile(name: string, data: string): Promise<void> {
  const bridge = native();
  if (bridge) {
    await bridge.invoke('save_workspace_file', { name, data });
    return;
  }
  localStorage.setItem(`blok:workspace:${name}`, data);
}

export async function dataDirectory(): Promise<string> {
  const bridge = native();
  if (bridge) return await bridge.invoke('workspace_data_directory') as string;
  return 'Navigateur local (localStorage)';
}

export async function loadIndex(): Promise<WorkspaceIndex> {
  const raw = await readFile('index');
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
  await saveIndex(index);
  return index;
}

export async function saveIndex(index: WorkspaceIndex): Promise<void> {
  await writeFile('index', JSON.stringify(index));
}
