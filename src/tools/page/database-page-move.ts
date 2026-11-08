import type { API, OutputBlockData } from '../../../types';
import type { PageConfig } from './types';

/** The page tool that makes full-page databases: its registered name and config. */
export interface DatabasePageHost {
  name: string;
  config: PageConfig;
}

/**
 * The page tool whose host opted into database pages. Turn into page needs
 * `create` to store the document it is given, which is what the opt-in promises.
 */
export const databasePageHost = (api: API): DatabasePageHost | null => {
  for (const tool of api.tools.getBlockTools()) {
    const config = tool.settings as PageConfig;

    if (config.databasePages === true && typeof config.create === 'function') {
      return { name: tool.name, config };
    }
  }

  return null;
};

/** The block and every block under it, in saved order. */
export const subtreeOf = (blocks: OutputBlockData[], rootId: string): OutputBlockData[] => {
  const childrenOf = new Map<string, string[]>();

  blocks.forEach((block) => {
    if (block.id !== undefined && block.parent !== undefined) childrenOf.set(block.parent, [...childrenOf.get(block.parent) ?? [], block.id]);
  });
  const inside = new Set<string>();
  const visit = (id: string): void => {
    if (inside.has(id)) return;
    inside.add(id);
    (childrenOf.get(id) ?? []).forEach(visit);
  };

  visit(rootId);

  return blocks.filter((block) => block.id !== undefined && inside.has(block.id));
};
