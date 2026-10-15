/**
 * A tab or tabs block made in a database's Customize layout and not applied
 * yet. `at` is when it was made (epoch ms); `by` holds the maker's awareness
 * client ids, empty without collaboration. Apply removes the mark.
 */
export interface LayoutDraft {
  at: number;
  by: number[];
}

/** The draft mark in a block's data, or undefined when there is none or it is malformed. */
export const layoutDraftOf = (data: unknown): LayoutDraft | undefined => {
  const draft: unknown = typeof data === 'object' && data !== null ? (data as { draft?: unknown }).draft : undefined;

  if (typeof draft !== 'object' || draft === null) return undefined;
  const { at, by } = draft as { at?: unknown; by?: unknown };

  if (typeof at !== 'number' || !Number.isFinite(at) || !Array.isArray(by)) return undefined;

  return { at, by: by.filter((id): id is number => typeof id === 'number') };
};
