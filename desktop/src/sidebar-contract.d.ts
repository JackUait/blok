export interface ShellPage {
  id: string;
  title: string;
  icon?: string;
  parentId: string | null;
  favorite?: boolean;
  /** Titre de section, dérivé de l'état de partage par l'hôte. */
  section?: string;
}
export type SidebarAction =
  | { id: string; type: 'rename'; title: string }
  | { id: string; type: 'duplicate' | 'delete' | 'move' | 'wiki' | 'open-tab' | 'open-window' | 'open-peek' }
  | { id: string; type: 'offline'; on: boolean };
export interface PageFrame {
  element: HTMLElement;
  canvas: HTMLElement;
  setPages(pages: ShellPage[], activeId: string): void;
  toggleSidebar(): void;
}
export function createPageFrame(options: {
  pages: ShellPage[];
  activeId: string;
  /** L'espace courant, rendu comme une ligne sous « Espaces » plutôt qu'un titre. */
  teamspace?: { name: string };
  onOpen(id: string): void;
  onCreate(parentId: string | null): void;
  onAction?(action: SidebarAction): void;
  onFavorite?(id: string, favorite: boolean): void;
  onCreatePrivate?(): void;
  onSearch?(recentIds?: string[]): void;
  recentIds?: string[];
  onRecentsChange?(ids: string[]): void;
  onTeamspaceMenu?(anchor: HTMLButtonElement): void;
  pageUrl?(id: string): string;
  availableActions?: SidebarAction['type'][];
  canEdit?(id: string): boolean;
  canCreate?(parentId: string | null): boolean;
}): PageFrame;
