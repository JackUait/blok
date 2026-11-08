export interface ShellPage {
  id: string;
  title: string;
  icon?: string;
  parentId: string | null;
  favorite?: boolean;
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
  onOpen(id: string): void;
  onCreate(parentId: string | null): void;
  onAction?(action: SidebarAction): void;
}): PageFrame;
