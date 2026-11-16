import type { ShellPage } from '@blok/sidebar';

export type MoveDestination = { parentId: string | null; title: string; path: string; icon?: string };

/** Re-evaluated when a destination is chosen: permissions can change while open. */
export function moveDestinations(options: {
  pages: ShellPage[];
  sourceId: string;
  rootLabel: string;
  canMove: (id: string) => boolean;
  canEdit: (id: string) => boolean;
  teamspaceOf: (id: string) => string | null;
  isSharedRoot?: (id: string) => boolean;
}): MoveDestination[] {
  const source = options.pages.find(page => page.id === options.sourceId);
  if (!source) return [];
  const subtree = new Set([source.id]);
  let previous = 0;
  while (previous !== subtree.size) {
    previous = subtree.size;
    options.pages.forEach(page => { if (page.parentId && subtree.has(page.parentId)) subtree.add(page.id); });
  }
  if ([...subtree].some(id => !options.canMove(id))) return [];
  const teamspace = options.teamspaceOf(source.id);
  const byId = new Map(options.pages.map(page => [page.id, page]));
  const destinations: MoveDestination[] = source.parentId || options.isSharedRoot?.(source.id) ? [{ parentId: null, title: options.rootLabel, path: 'À la racine de cet espace' }] : [];
  for (const page of options.pages) {
    if (subtree.has(page.id) || page.id === source.parentId || !options.canEdit(page.id) || options.teamspaceOf(page.id) !== teamspace) continue;
    const ancestors: string[] = [];
    const seen = new Set([page.id]);
    let parent = page.parentId ? byId.get(page.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id); ancestors.unshift(parent.title); parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    destinations.push({ parentId: page.id, title: page.title || 'Nouvelle page', icon: page.icon, path: [options.rootLabel, ...ancestors].join(' / ') });
  }
  return destinations;
}
