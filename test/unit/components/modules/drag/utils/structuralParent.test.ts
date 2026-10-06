import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deepestLegalStructuralDepth,
  resolveStructuralParent,
} from '../../../../../../src/components/modules/drag/utils/structuralParent';

describe('structuralParent — a block that takes no children', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const page = { id: 'pg', isList: false, acceptsChildren: false, depth: 0 };
  const paragraph = { id: 'p', isList: false, acceptsChildren: true, depth: 0 };

  it('never nests a dropped list item under a preceding page', () => {
    expect(resolveStructuralParent(true, 1, [page])).toBeNull();
  });

  it('still nests a dropped list item under a preceding paragraph', () => {
    expect(resolveStructuralParent(true, 1, [paragraph])).toBe('p');
  });

  it('never previews an indent under a page', () => {
    expect(deepestLegalStructuralDepth(true, 1, [page])).toBe(0);
  });
});
