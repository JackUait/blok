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

/** Puts `make(node)` where the node with `nodeId` was. */
const replaceFilterNode = (tree: FilterGroup, nodeId: string, make: (node: FilterNode) => FilterNode[]): FilterGroup =>
  mapGroups(tree, (group) => (group.filterRules.some((child) => child.id === nodeId)
    ? { ...group, filterRules: group.filterRules.flatMap((child) => (child.id === nodeId ? make(child) : [child])) }
    : group));

const withFreshIds = (node: FilterNode): FilterNode => (isFilterGroup(node)
  ? { ...node, id: nanoid(), filterRules: node.filterRules.map(withFreshIds) }
  : { ...node, id: nanoid() });

/** Group layers inside a node: 0 for a rule, 1 for a group of rules. */
const groupHeight = (node: FilterNode): number => (isFilterGroup(node)
  ? 1 + Math.max(0, ...node.filterRules.map(groupHeight))
  : 0);

const parentOf = (tree: FilterGroup, nodeId: string): FilterGroup | undefined => {
  if (tree.filterRules.some((child) => child.id === nodeId)) return tree;

  for (const child of tree.filterRules) {
    const found = isFilterGroup(child) ? parentOf(child, nodeId) : undefined;

    if (found !== undefined) return found;
  }

  return undefined;
};

/** A copy right after the node, with new ids all the way down so edits keep the two apart. */
export const duplicateFilterNode = (tree: FilterGroup, nodeId: string): FilterGroup =>
  replaceFilterNode(tree, nodeId, (node) => [node, withFreshIds(node)]);

/** Whether the node can go into a new group without passing MAX_FILTER_DEPTH. */
export const canGroupFilterNode = (tree: FilterGroup, nodeId: string): boolean => {
  const parent = parentOf(tree, nodeId);
  const node = parent?.filterRules.find((child) => child.id === nodeId);

  return parent !== undefined && node !== undefined && filterGroupDepth(tree, parent.id) + 1 + groupHeight(node) <= MAX_FILTER_DEPTH;
};

/** Turn a rule into a group, or wrap a group in one: a new group holding the node, in its place. */
export const groupFilterNode = (tree: FilterGroup, nodeId: string, group: Omit<FilterGroup, 'filterRules'>): FilterGroup => {
  if (!canGroupFilterNode(tree, nodeId)) return tree;

  return replaceFilterNode(tree, nodeId, (node) => [{ ...group, filterRules: [node] }]);
};

/** A group of one item becomes that item. A bigger group stays, so no rule is lost. */
export const unwrapFilterGroup = (tree: FilterGroup, groupId: string): FilterGroup => {
  const group = parentOf(tree, groupId)?.filterRules.find((child) => child.id === groupId);

  if (group === undefined || !isFilterGroup(group) || group.filterRules.length !== 1) return tree;

  return replaceFilterNode(tree, groupId, () => group.filterRules);
};

export { withEntryIds } from '../../shared/database/view-changes';
