export interface PageOutline {
  blockId: string;
  pageId: string;
  title: string;
  type: 'database';
}

/** Read-only navigation metadata. Never use this projection to initialize an editor. */
export function extractPageOutline(pageId: string, document: unknown): PageOutline[] {
  if (typeof document !== 'object' || document === null || !('blocks' in document) || !Array.isArray(document.blocks)) return [];
  const outline: PageOutline[] = [];
  const seen = new Set<string>();
  for (const block of document.blocks as unknown[]) {
    if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'database'
      || !('id' in block) || typeof block.id !== 'string' || !block.id || seen.has(block.id)) continue;
    const data = 'data' in block ? block.data : null;
    const title = typeof data === 'object' && data !== null && 'title' in data && typeof data.title === 'string' ? data.title.trim() : '';
    outline.push({ blockId: block.id, pageId, title: title || 'Base de données', type: 'database' });
    seen.add(block.id);
  }
  return outline;
}
