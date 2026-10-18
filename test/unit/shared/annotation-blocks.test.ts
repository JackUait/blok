import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ANNOTATION_BLOCK_TYPES, withoutAnnotations } from '../../../src/shared/annotation-blocks';
import { BUILT_IN_BLOCK_STATICS } from '../../../src/shared/tool-descriptions/built-in-statics';
import { BLOCK_CLASSES } from './tool-descriptions/built-in-tools';

describe('annotation block types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists exactly the built-in tools that declare isAnnotation', () => {
    const declared = Object.entries(BLOCK_CLASSES)
      .filter(([, toolClass]) => (toolClass as { isAnnotation?: boolean }).isAnnotation === true)
      .map(([name]) => name);

    expect([...ANNOTATION_BLOCK_TYPES]).toEqual(declared);
    expect(Object.entries(BUILT_IN_BLOCK_STATICS).filter(([, entry]) => entry.statics.isAnnotation === true).map(([name]) => name)).toEqual(declared);
  });

  it('drops a thread with its replies and keeps the rest in order', () => {
    const kept = withoutAnnotations([
      { id: 'a', type: 'paragraph' },
      { id: 'k', type: 'database-comment', parent: 'a' },
      { id: 'r', type: 'paragraph', parent: 'k' },
      { id: 'b', type: 'paragraph', parent: 'a' },
    ]);

    expect(kept.map((block) => block.id)).toEqual(['a', 'b']);
  });
});
