import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MAX_FILTER_DEPTH,
  addFilterGroup,
  addFilterRule,
  countFilterRules,
  filterGroupDepth,
  isFilterGroup,
  removeFilterNode,
  rowMatchesFilterTree,
  setFilterConjunction,
  updateFilterRule,
  withEntryIds,
} from '../../../../src/tools/database/filter-tree';
import type { DatabaseRow, FilterGroup, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'num', name: 'Score', type: 'number', position: 'a1' },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a2' },
];

const row = (properties: Record<string, PropertyValue>): DatabaseRow => ({ id: 'r', position: 'a0', properties });

const group = (id: string, conjunction: 'and' | 'or', filterRules: FilterGroup['filterRules']): FilterGroup =>
  ({ id, conjunction, filterRules });

const NOW = new Date(2026, 9, 9, 12, 0);

describe('filter-tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rowMatchesFilterTree', () => {
    const big = { id: 'r1', propertyId: 'num', operator: 'greater_than', value: 10 };
    const checked = { id: 'r2', propertyId: 'done', operator: 'equals', value: true };

    it('needs every rule in an And group', () => {
      const tree = group('g', 'and', [big, checked]);

      expect(rowMatchesFilterTree(row({ num: 20, done: true }), tree, schema, NOW)).toBe(true);
      expect(rowMatchesFilterTree(row({ num: 20, done: false }), tree, schema, NOW)).toBe(false);
    });

    it('needs one rule in an Or group', () => {
      const tree = group('g', 'or', [big, checked]);

      expect(rowMatchesFilterTree(row({ num: 1, done: true }), tree, schema, NOW)).toBe(true);
      expect(rowMatchesFilterTree(row({ num: 1, done: false }), tree, schema, NOW)).toBe(false);
    });

    it('evaluates nested groups', () => {
      const tree = group('g', 'and', [
        { id: 'r0', propertyId: 'title', operator: 'contains', value: 'a' },
        group('g2', 'or', [big, checked]),
      ]);

      expect(rowMatchesFilterTree(row({ title: 'Alpha', num: 1, done: true }), tree, schema, NOW)).toBe(true);
      expect(rowMatchesFilterTree(row({ title: 'Bob', num: 20 }), tree, schema, NOW)).toBe(false);
      expect(rowMatchesFilterTree(row({ title: 'Alpha', num: 1, done: false }), tree, schema, NOW)).toBe(false);
    });

    it('ignores a rule without a value, so a fresh rule in an Or group hides nothing', () => {
      const blank = { id: 'r3', propertyId: 'title', operator: 'contains', value: '' };

      expect(rowMatchesFilterTree(row({ num: 1, done: false }), group('g', 'or', [blank, checked]), schema, NOW)).toBe(false);
      expect(rowMatchesFilterTree(row({ num: 1 }), group('g', 'or', [blank]), schema, NOW)).toBe(true);
      expect(rowMatchesFilterTree(row({}), group('g', 'and', []), schema, NOW)).toBe(true);
    });

    it('lets rows through a rule on a deleted property', () => {
      const tree = group('g', 'and', [{ id: 'r', propertyId: 'gone', operator: 'equals', value: 'x' }]);

      expect(rowMatchesFilterTree(row({}), tree, schema, NOW)).toBe(true);
    });
  });

  describe('editing', () => {
    const tree = group('root', 'and', [
      { id: 'a', propertyId: 'num', operator: 'equals', value: 1 },
      group('g2', 'or', [group('g3', 'and', [])]),
    ]);

    it('adds a rule to the named group only', () => {
      const next = addFilterRule(tree, 'g3', { id: 'new', propertyId: 'num', operator: 'equals', value: 2 });

      expect(JSON.stringify(next)).toContain('"id":"new"');
      expect(countFilterRules(next)).toBe(2);
      expect(tree).not.toBe(next);
      expect(countFilterRules(tree)).toBe(1);
    });

    it('stops nesting groups below three levels', () => {
      expect(MAX_FILTER_DEPTH).toBe(3);
      expect(filterGroupDepth(tree, 'g3')).toBe(3);
      expect(addFilterGroup(tree, 'g3', group('g4', 'and', []))).toBe(tree);
      expect(JSON.stringify(addFilterGroup(tree, 'g2', group('g4', 'and', [])))).toContain('"g4"');
    });

    it('removes a node anywhere in the tree', () => {
      const next = removeFilterNode(tree, 'g3');

      expect(JSON.stringify(next)).not.toContain('g3');
      expect(JSON.stringify(removeFilterNode(tree, 'a'))).not.toContain('"a"');
    });

    it('updates a rule and a conjunction', () => {
      const next = setFilterConjunction(updateFilterRule(tree, 'a', { value: 5 }), 'g2', 'and');
      const [first, second] = next.filterRules;

      expect(first).toEqual({ id: 'a', propertyId: 'num', operator: 'equals', value: 5 });
      expect(isFilterGroup(second) && second.conjunction).toBe('and');
    });
  });

  describe('withEntryIds', () => {
    it('gives every entry an id and keeps ids already there', () => {
      const result = withEntryIds([{ id: 'keep', propertyId: 'a' }, { propertyId: 'b' }]);

      expect(result[0].id).toBe('keep');
      expect(typeof result[1].id).toBe('string');
      expect(result[1].id.length).toBeGreaterThan(0);
    });
  });
});
