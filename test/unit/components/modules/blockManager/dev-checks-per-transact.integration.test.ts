/**
 * In dev/test, the hierarchy and tree-order checks walk the whole document.
 * A tool's transact runs them once at its end, not once per block it adds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API } from '../../../../../types';
import type * as HierarchyInvariant from '../../../../../src/components/utils/hierarchy-invariant';

const counted = vi.hoisted(() => ({ hierarchy: 0, treeOrder: 0 }));

vi.mock('../../../../../src/components/utils/hierarchy-invariant', async (importOriginal) => {
  const actual = await importOriginal<typeof HierarchyInvariant>();

  return {
    ...actual,
    validateHierarchy: (...args: Parameters<typeof actual.validateHierarchy>) => {
      counted.hierarchy += 1;

      return actual.validateHierarchy(...args);
    },
    validateTreeOrder: (...args: Parameters<typeof actual.validateTreeOrder>) => {
      counted.treeOrder += 1;

      return actual.validateTreeOrder(...args);
    },
  };
});

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

describe('dev checks inside a tool transact', () => {
  let editor: TestEditor | undefined;
  let holder: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('walks the document as often for ten inserts in one transact as for one', async () => {
    editor = new Blok({ holder, tools: { paragraph: Paragraph }, data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'a' } }] } }) as unknown as TestEditor;
    await editor.isReady;
    await settle();

    const walksFor = (inserts: number): number => {
      counted.hierarchy = 0;
      counted.treeOrder = 0;
      editor?.blocks.transact?.(() => {
        Array.from({ length: inserts }).forEach(() => editor?.blocks.insert('paragraph', { text: 'x' }));
      });

      return counted.hierarchy + counted.treeOrder;
    };

    const one = walksFor(1);
    const ten = walksFor(10);

    expect(editor.blocks.getBlocksCount()).toBe(12);
    expect(one).toBeGreaterThan(0);
    expect(ten).toBe(one);
  });
});
