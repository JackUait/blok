import { nanoid } from 'nanoid';
import { isFilterGroup, rowMatchesFilterTree } from './database-query';
import type { FilterConjunction, FilterGroup, FilterNode, FilterRule } from './types';

/** Notion's help says advanced filters nest "up to three layers deep"; the root group is layer one. */
export const MAX_FILTER_DEPTH = 3;

export { isFilterGroup, rowMatchesFilterTree };

export const emptyFilterTree = (): FilterGroup => ({ id: nanoid(), conjunction: 'and', filterRules: [] });

export const countFilterRules = (node: FilterNode | undefined): number => {
  if (node === undefined) return 0;

  return isFilterGroup(node) ? node.filterRules.reduce((sum, child) => sum + countFilterRules(child), 0) : 1;
};

/** The layer a group sits on (root is 1), or 0 when the tree lacks it. */
export const filterGroupDepth = (tree: FilterGroup, groupId: string, depth = 1): number => {
  if (tree.id === groupId) return depth;

  for (const child of tree.filterRules) {
    const found = isFilterGroup(child) ? filterGroupDepth(child, groupId, depth + 1) : 0;

    if (found > 0) return found;
  }

  return 0;
};

/** Rebuilds the path to every node `edit` changes; untouched subtrees are shared. */
const mapGroups = (group: FilterGroup, edit: (group: FilterGroup) => FilterGroup): FilterGroup => {
  const children = group.filterRules.map((child) => (isFilterGroup(child) ? mapGroups(child, edit) : child));

  return edit({ ...group, filterRules: children });
};

export const addFilterRule = (tree: FilterGroup, groupId: string, rule: FilterRule): FilterGroup =>
  mapGroups(tree, (group) => (group.id === groupId ? { ...group, filterRules: [...group.filterRules, rule] } : group));

/** Returns `tree` itself when the new group would sit deeper than MAX_FILTER_DEPTH. */
export const addFilterGroup = (tree: FilterGroup, parentId: string, group: FilterGroup): FilterGroup => {
  const depth = filterGroupDepth(tree, parentId);

  if (depth === 0 || depth >= MAX_FILTER_DEPTH) return tree;

  return mapGroups(tree, (g) => (g.id === parentId ? { ...g, filterRules: [...g.filterRules, group] } : g));
};

export const removeFilterNode = (tree: FilterGroup, nodeId: string): FilterGroup =>
  mapGroups(tree, (group) => ({ ...group, filterRules: group.filterRules.filter((child) => child.id !== nodeId) }));

export const updateFilterRule = (
  tree: FilterGroup,
  ruleId: string,
  patch: Partial<Omit<FilterRule, 'id'>>
): FilterGroup =>
  mapGroups(tree, (group) => ({
    ...group,
    filterRules: group.filterRules.map((child) => (!isFilterGroup(child) && child.id === ruleId ? { ...child, ...patch } : child)),
  }));

export const setFilterConjunction = (tree: FilterGroup, groupId: string, conjunction: FilterConjunction): FilterGroup =>
  mapGroups(tree, (group) => (group.id === groupId ? { ...group, conjunction } : group));

/**
 * Gives every entry an id. Old documents hold filters and sorts without one;
 * every write adds them so two peers' entries pair by id.
 */
export const withEntryIds = <T extends { id?: string }>(entries: readonly T[]): Array<T & { id: string }> =>
  entries.map((entry) => (typeof entry.id === 'string' && entry.id !== '' ? entry as T & { id: string } : { ...entry, id: nanoid() }));
