// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageIndex, projectPageTree } from '../../../src/view';
import type { HostPageEdge, PageTextEntry } from '../../../src/view';
import type { OutputData } from '../../../types';

describe('page catalog projection from saved documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces owner and text facts when a saved pointer moves to another document', () => {
    const ownersByDocument = new Map<string, HostPageEdge[]>();
    const textByDocument = new Map<string, PageTextEntry[]>();
    const indexDocument = (documentId: string, ownerPageId: string | null, saved: OutputData): void => {
      const facts = pageIndex(saved);

      ownersByDocument.set(documentId, facts.owners.map((edge) => ({ ...edge, ownerPageId })));
      textByDocument.set(documentId, facts.text);
    };
    const project = (): ReturnType<typeof projectPageTree> =>
      projectPageTree(
        [...ownersByDocument.values()].flat(),
        { parent: { title: 'Parent' }, child: { title: 'Child' } }
      );

    indexDocument('root-doc', null, {
      blocks: [
        { id: 'parent-pointer', type: 'page', data: { pageId: 'parent' } },
        { id: 'child-pointer', type: 'page', data: { pageId: 'child' } },
        { id: 'root-text', type: 'paragraph', data: { text: 'Before' } },
      ],
    });
    indexDocument('parent-doc', 'parent', { blocks: [] });

    expect(project().roots.map((node) => node.pageId)).toEqual(['parent', 'child']);
    expect(textByDocument.get('root-doc')?.find((entry) => entry.blockId === 'root-text')?.text).toBe('Before');

    indexDocument('root-doc', null, {
      blocks: [
        { id: 'parent-pointer', type: 'page', data: { pageId: 'parent' } },
        { id: 'root-text', type: 'paragraph', data: { text: 'After' } },
      ],
    });
    indexDocument('parent-doc', 'parent', {
      blocks: [{ id: 'child-pointer', type: 'page', data: { pageId: 'child' } }],
    });

    const projected = project();

    expect(projected.roots.map((node) => node.pageId)).toEqual(['parent']);
    expect(projected.roots[0]?.children.map((node) => node.pageId)).toEqual(['child']);
    expect(projected.diagnostics).toEqual([]);
    expect([...ownersByDocument.values()].flat().filter((edge) => edge.pageId === 'child')).toHaveLength(1);
    expect(textByDocument.get('root-doc')?.find((entry) => entry.blockId === 'root-text')?.text).toBe('After');
    expect(textByDocument.get('root-doc')?.some((entry) => entry.text === 'Before')).toBe(false);
  });
});
