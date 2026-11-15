import type { Blocks } from '../../types/api/blocks';
import type { SummarySource } from './ai-summary';
export interface AiPageSnapshot {id: string; editor: {isReady: Promise<unknown>; blocks: Pick<Blocks, 'exportMarkdown'>}}
/** Export saved semantic blocks, never the rendered editor chrome or placeholders. */
export async function readAiPageSource(snapshot: AiPageSnapshot | null, stillAccessible: () => boolean): Promise<SummarySource | null> {
  if (!snapshot || !stillAccessible()) return null;
  await snapshot.editor.isReady;
  if (!stillAccessible()) return null;
  const text = await snapshot.editor.blocks.exportMarkdown({title:true});
  // Navigation and access revocation can happen while asynchronous tools save.
  return stillAccessible() ? {id:snapshot.id,text} : null;
}
