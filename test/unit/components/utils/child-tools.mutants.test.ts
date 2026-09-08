import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  getChildToolRestrictions,
  isChildToolAllowed,
  resolveChildTool,
  restrictedChildToolNames,
  satisfiesChildToolRestrictions,
} from '../../../../src/components/utils/child-tools';

import type { Block } from '../../../../src/components/block';
import type { ChildToolRestrictions } from '@/types/tools';

/**
 * Mutant notes for src/components/utils/child-tools.ts
 *
 * KILLABLE, DELIBERATELY NOT KILLED — OptionalChaining at line 31,
 * `parent?.tool?.childTools` narrowed to `parent?.tool.childTools`.
 * The two differ only when `parent` exists and `parent.tool` does not, and
 * `Block.tool` is a readonly, always-assigned `BlockToolAdapter`. Every call
 * site (block-insertion, block-mutation, yjs-sync, toolbox) hands over a real
 * Block. Only a stub that violates the Block type can tell them apart.
 *
 * PROVEN EQUIVALENT — OptionalChaining at line 100, the first `?.` of
 * `getChildToolRestrictions(parent)?.allow?.[0]`.
 * Line 100 runs only after `isChildToolAllowed(parent, requestedTool)` returned
 * false, and that helper returns TRUE whenever `getChildToolRestrictions`
 * yields undefined. So on the one path that reaches line 100 the call cannot
 * have returned undefined, and the removed guard can never fire. The two reads
 * agree because both are the same pure property read of the same parent.
 *
 * PROVEN EQUIVALENT — ConditionalExpression at line 114 and the BlockStatement
 * at 114, both of which delete the `restrictions === undefined` early return in
 * restrictedChildToolNames.
 * Falling through runs `candidateToolNames.filter((name) =>
 * !satisfiesChildToolRestrictions(undefined, name))`, and that helper returns
 * true for EVERY name when the restrictions are undefined. The predicate is
 * therefore false for every candidate and the filter yields an empty array —
 * the same value the deleted early return produced.
 */

/**
 * A parent whose adapter declares `childTools`. The adapter getter forwards an
 * untyped static off the tool class, so null is a real runtime value here.
 */
const makeParent = (childTools?: ChildToolRestrictions | null): Block => {
  const parent: { tool: { childTools?: ChildToolRestrictions | null } } = { tool: { childTools } };

  return parent as Block;
};

describe('getChildToolRestrictions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('reads a declaration off the parent tool', () => {
    const restrictions: ChildToolRestrictions = { allow: ['column'] };

    expect(getChildToolRestrictions(makeParent(restrictions))).toStrictEqual({ allow: ['column'] });
  });

  it('treats a tool that declares null as unrestricted', () => {
    expect(getChildToolRestrictions(makeParent(null))).toBeUndefined();
  });

  it('treats a missing declaration as unrestricted', () => {
    expect(getChildToolRestrictions(makeParent())).toBeUndefined();
    expect(getChildToolRestrictions(undefined)).toBeUndefined();
    expect(getChildToolRestrictions(null)).toBeUndefined();
  });

  it('treats empty allow and deny lists as unrestricted', () => {
    expect(getChildToolRestrictions(makeParent({ allow: [],
      deny: [] }))).toBeUndefined();
  });
});

describe('satisfiesChildToolRestrictions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('permits any tool when the allow list is empty', () => {
    expect(satisfiesChildToolRestrictions({ allow: [] }, 'paragraph')).toBe(true);
  });

  it('permits only the listed tools when the allow list has entries', () => {
    expect(satisfiesChildToolRestrictions({ allow: ['column'] }, 'column')).toBe(true);
    expect(satisfiesChildToolRestrictions({ allow: ['column'] }, 'paragraph')).toBe(false);
  });

  it('lets deny win over allow', () => {
    expect(satisfiesChildToolRestrictions({ allow: ['column'],
      deny: ['column'] }, 'column')).toBe(false);
  });

  it('permits everything without a declaration', () => {
    expect(satisfiesChildToolRestrictions(undefined, 'paragraph')).toBe(true);
  });
});

describe('isChildToolAllowed and resolveChildTool', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('allows any tool under a parent with no declaration', () => {
    expect(isChildToolAllowed(makeParent(), 'paragraph')).toBe(true);
    expect(resolveChildTool(makeParent(), 'paragraph', 'paragraph')).toBe('paragraph');
  });

  it('demotes a disallowed tool to the first allowed one', () => {
    const parent = makeParent({ allow: ['column', 'callout'] });

    expect(isChildToolAllowed(parent, 'paragraph')).toBe(false);
    expect(resolveChildTool(parent, 'paragraph', 'paragraph')).toBe('column');
  });

  it('falls back to the default block when only a deny list is declared', () => {
    const parent = makeParent({ deny: ['table'] });

    expect(resolveChildTool(parent, 'table', 'paragraph')).toBe('paragraph');
  });
});

describe('restrictedChildToolNames', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns nothing without a declaration', () => {
    expect(restrictedChildToolNames(undefined, ['paragraph', 'table'])).toStrictEqual([]);
  });

  it('returns the candidates the declaration rejects', () => {
    expect(restrictedChildToolNames({ allow: ['column'] }, ['column', 'paragraph', 'table']))
      .toStrictEqual(['paragraph', 'table']);
  });
});
