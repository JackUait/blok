import { describe, it, expect } from 'vitest';
import { analyzeDataFormat, expandToHierarchical, collapseToLegacy, normalizeTableChildParents } from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData, BlockId } from '../../../../types';

describe('data-model-transform', () => {
  describe('analyzeDataFormat - legacy toggleList', () => {
    it('detects legacy format when blocks contain toggleList type', () => {
      const blocks: OutputBlockData[] = [
        {
          type: 'toggleList',
          data: {
            title: 'Toggle heading',
          },
        },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('legacy');
    });

    it('detects legacy format with hierarchy when toggleList has body.blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          type: 'toggleList',
          data: {
            title: 'Toggle heading',
            body: {
              blocks: [
                { id: 'child-1', type: 'paragraph', data: { text: 'child text' } },
              ],
            },
          },
        },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('legacy');
      expect(result.hasHierarchy).toBe(true);
    });

    it('returns flat format when no toggleList or list blocks present', () => {
      const blocks: OutputBlockData[] = [
        { id: 'p1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'h1', type: 'header', data: { text: 'Title', level: 1 } },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('flat');
      expect(result.hasHierarchy).toBe(false);
    });
  });

  describe('analyzeDataFormat - legacy callout', () => {
    it('detects legacy format when blocks contain callout with body field', () => {
      const blocks: OutputBlockData[] = [
        {
          type: 'callout',
          data: {
            body: { blocks: [] },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('legacy');
    });

    it('detects legacy format with hierarchy when callout has body.blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'c1', type: 'paragraph', data: { text: 'child text' } },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('legacy');
      expect(result.hasHierarchy).toBe(true);
    });

    it('does not detect new-format callout as legacy', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' } },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('flat');
    });
  });

  describe('analyzeDataFormat - hybrid format (hierarchical + legacy)', () => {
    it('detects legacy format when hierarchical table coexists with legacy callout', () => {
      const blocks: OutputBlockData[] = [
        // Table already migrated to hierarchical
        {
          id: 't1',
          type: 'table',
          data: { content: [[{ blocks: ['p1'] }]], stretched: false },
          content: ['p1'],
        },
        // Callout still in legacy format
        {
          id: 'c1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'cp1', type: 'paragraph', data: { text: 'callout child' } },
              ],
            },
            variant: 'additional',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
        // Table child with parent ref
        { id: 'p1', type: 'paragraph', data: { text: 'table cell' }, parent: 't1' },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('legacy');
      expect(result.hasHierarchy).toBe(true);
    });

    it('detects legacy format when hierarchical refs coexist with legacy toggleList', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'table',
          data: { content: [[{ blocks: ['p1'] }]], stretched: false },
          content: ['p1'],
        },
        {
          id: 'tg1',
          type: 'toggleList',
          data: {
            title: 'Toggle heading',
            body: {
              blocks: [
                { id: 'tc1', type: 'paragraph', data: { text: 'toggle child' } },
              ],
            },
          },
        },
        { id: 'p1', type: 'paragraph', data: { text: 'table cell' }, parent: 't1' },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('legacy');
      expect(result.hasHierarchy).toBe(true);
    });

    it('returns hierarchical when no legacy blocks remain alongside hierarchical refs', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'table',
          data: { content: [[{ blocks: ['p1'] }]], stretched: false },
          content: ['p1'],
        },
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' }, content: ['p2'] },
        { id: 'p1', type: 'paragraph', data: { text: 'table cell' }, parent: 't1' },
        { id: 'p2', type: 'paragraph', data: { text: 'callout child' }, parent: 'c1' },
      ];

      const result = analyzeDataFormat(blocks);

      expect(result.format).toBe('hierarchical');
      expect(result.hasHierarchy).toBe(true);
    });
  });

  describe('expandToHierarchical - hybrid format', () => {
    it('expands legacy callout while preserving already-hierarchical table blocks', () => {
      const blocks: OutputBlockData[] = [
        // Already-hierarchical table
        {
          id: 't1',
          type: 'table',
          data: { content: [[{ blocks: ['tp1'] }]], stretched: false },
          content: ['tp1'],
        },
        // Legacy callout needing expansion
        {
          id: 'c1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'cp1', type: 'paragraph', data: { text: 'callout child text' } },
              ],
            },
            variant: 'additional',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
        // Regular paragraph
        { id: 'para1', type: 'paragraph', data: { text: 'standalone paragraph' } },
        // Table child
        { id: 'tp1', type: 'paragraph', data: { text: 'table cell' }, parent: 't1' },
      ];

      const result = expandToHierarchical(blocks);

      // Table block preserved unchanged
      const table = result.find(b => b.id === 't1');

      expect(table).toBeDefined();
      expect(table!.content).toEqual(['tp1']);

      // Callout expanded to new format
      const callout = result.find(b => b.id === 'c1');

      expect(callout).toBeDefined();
      expect(callout!.data).toEqual({
        emoji: '💡',
        textColor: null,
        backgroundColor: 'yellow',
      });
      expect(callout!.content).toEqual(['cp1']);

      // Callout child extracted as flat block with parent ref
      const calloutChild = result.find(b => b.id === 'cp1');

      expect(calloutChild).toBeDefined();
      expect(calloutChild!.parent).toBe('c1');
      expect(calloutChild!.data.text).toBe('callout child text');

      // Table child preserved unchanged
      const tableChild = result.find(b => b.id === 'tp1');

      expect(tableChild).toBeDefined();
      expect(tableChild!.parent).toBe('t1');

      // Standalone paragraph preserved
      const para = result.find(b => b.id === 'para1');

      expect(para).toBeDefined();
      expect(para!.data.text).toBe('standalone paragraph');
    });

    it('expands multiple legacy callouts in hybrid data', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'table',
          data: { content: [[{ blocks: ['tp1'] }]], stretched: false },
          content: ['tp1'],
        },
        {
          id: 'c1',
          type: 'callout',
          data: {
            body: { blocks: [{ id: 'cp1', type: 'paragraph', data: { text: 'first callout child' } }] },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: false,
          },
        },
        {
          id: 'c2',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'cp2', type: 'paragraph', data: { text: 'second callout child 1' } },
                { id: 'cp3', type: 'paragraph', data: { text: 'second callout child 2' } },
              ],
            },
            variant: 'recommendation',
            emoji: '🔥',
            isEmojiVisible: true,
          },
        },
        { id: 'tp1', type: 'paragraph', data: { text: 'table cell' }, parent: 't1' },
      ];

      const result = expandToHierarchical(blocks);

      // First callout: emoji hidden, note variant
      const c1 = result.find(b => b.id === 'c1');

      expect(c1!.data.emoji).toBe('');
      expect(c1!.data.backgroundColor).toBe('blue');
      expect(c1!.content).toEqual(['cp1']);

      // Second callout: emoji visible, recommendation variant, 2 children
      const c2 = result.find(b => b.id === 'c2');

      expect(c2!.data.emoji).toBe('🔥');
      expect(c2!.data.backgroundColor).toBe('green');
      expect(c2!.content).toEqual(['cp2', 'cp3']);

      // All children extracted
      expect(result.find(b => b.id === 'cp1')!.parent).toBe('c1');
      expect(result.find(b => b.id === 'cp2')!.parent).toBe('c2');
      expect(result.find(b => b.id === 'cp3')!.parent).toBe('c2');
    });
  });

  describe('expandToHierarchical - legacy toggleList', () => {
    it('expands toggleList block into toggle parent + child blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Toggle heading',
            body: {
              blocks: [
                { id: 'c1', type: 'paragraph', data: { text: 'child text' } },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('toggle');
      expect(result[1].type).toBe('paragraph');
    });

    it('maps title to text', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'My Toggle Title',
            body: { blocks: [] },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.text).toBe('My Toggle Title');
    });

    it('maps isExpanded to isOpen', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Toggle',
            isExpanded: true,
            body: { blocks: [] },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.isOpen).toBe(true);
    });

    it('sets parent reference on child blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Toggle',
            body: {
              blocks: [
                { id: 'c1', type: 'paragraph', data: { text: 'child' } },
                { id: 'c2', type: 'header', data: { text: 'heading', level: 2 } },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[1].parent).toBe('t1');
      expect(result[2].parent).toBe('t1');
    });

    it('sets content array on toggle block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Toggle',
            body: {
              blocks: [
                { id: 'c1', type: 'paragraph', data: { text: 'child 1' } },
                { id: 'c2', type: 'paragraph', data: { text: 'child 2' } },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].content).toEqual(['c1', 'c2']);
    });

    it('preserves child block types and data unchanged', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Toggle',
            body: {
              blocks: [
                { id: 'c1', type: 'paragraph', data: { text: 'paragraph text' } },
                { id: 'c2', type: 'header', data: { text: 'heading', level: 3 } },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[1].type).toBe('paragraph');
      expect(result[1].data).toEqual({ text: 'paragraph text' });
      expect(result[2].type).toBe('header');
      expect(result[2].data).toEqual({ text: 'heading', level: 3 });
    });

    it('handles toggleList with empty body', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Empty toggle',
            body: { blocks: [] },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('toggle');
      expect(result[0].data.text).toBe('Empty toggle');
      expect(result[0].content).toBeUndefined();
    });

    it('handles toggleList with no body property', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'No body toggle',
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('toggle');
      expect(result[0].data.text).toBe('No body toggle');
      expect(result[0].content).toBeUndefined();
    });

    it('recursively expands nested toggleList blocks inside a toggleList body', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'outer',
          type: 'toggleList',
          data: {
            title: 'Outer',
            body: {
              blocks: [
                {
                  id: 'inner',
                  type: 'toggleList',
                  data: {
                    title: 'Inner',
                    isExpanded: true,
                    body: {
                      blocks: [
                        { id: 'leaf', type: 'paragraph', data: { text: 'leaf text' } },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      // No legacy toggleList types should survive expansion at any depth.
      expect(result.every(b => b.type !== 'toggleList')).toBe(true);

      // Outer becomes a toggle that points to inner.
      const outer = result.find(b => b.id === 'outer');
      expect(outer).toBeDefined();
      expect(outer?.type).toBe('toggle');
      expect(outer?.content).toEqual(['inner']);

      // Inner is also expanded to a toggle (not left as toggleList) and parented to outer.
      const inner = result.find(b => b.id === 'inner');
      expect(inner).toBeDefined();
      expect(inner?.type).toBe('toggle');
      expect(inner?.parent).toBe('outer');
      expect(inner?.data.text).toBe('Inner');
      expect(inner?.data.isOpen).toBe(true);
      expect(inner?.content).toEqual(['leaf']);

      // Leaf paragraph survives and is parented to inner.
      const leaf = result.find(b => b.id === 'leaf');
      expect(leaf).toBeDefined();
      expect(leaf?.type).toBe('paragraph');
      expect(leaf?.parent).toBe('inner');
    });

    it('recursively expands nested toggleList children with empty bodies', () => {
      // Mirrors the real-world article shape: a toggleList parent whose body
      // is a list of empty toggleList children.
      const blocks: OutputBlockData[] = [
        {
          id: 'parent',
          type: 'toggleList',
          data: {
            title: 'Критерии',
            body: {
              blocks: [
                { id: 'c1', type: 'toggleList', data: { title: 'A', isExpanded: false, body: { blocks: [] } } },
                { id: 'c2', type: 'toggleList', data: { title: 'B', isExpanded: false, body: { blocks: [] } } },
                { id: 'c3', type: 'toggleList', data: { title: 'C', isExpanded: false, body: { blocks: [] } } },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result.every(b => b.type !== 'toggleList')).toBe(true);
      const childToggles = result.filter(b => b.parent === 'parent');
      expect(childToggles).toHaveLength(3);
      expect(childToggles.every(b => b.type === 'toggle')).toBe(true);
      expect(childToggles.map(b => (b.data as { text: string }).text)).toEqual(['A', 'B', 'C']);
    });

    it('recursively expands nested toggleList with titleVariant into toggle headings', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'outer',
          type: 'toggleList',
          data: {
            title: 'Outer',
            body: {
              blocks: [
                {
                  id: 'innerHeading',
                  type: 'toggleList',
                  data: {
                    title: 'Heading-toggle',
                    titleVariant: 2,
                  },
                },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result.every(b => b.type !== 'toggleList')).toBe(true);
      const inner = result.find(b => b.id === 'innerHeading');
      expect(inner?.type).toBe('header');
      expect(inner?.parent).toBe('outer');
      expect(inner?.data.isToggleable).toBe(true);
      expect(inner?.data.level).toBe(2);
    });

    it('keeps multi-item legacy list inside callout body as callout descendants (regression: dodois KRZH article)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'p1', type: 'paragraph', data: { text: 'Если ты заметил...' } },
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: [
                      'Убедись, что в раковине для посуды нет инвентаря;',
                      'Сполосни кружку проточной водой.',
                    ],
                  },
                },
              ],
            },
            variant: 'info',
            emoji: 'ℹ️',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const callout = result.find(b => b.id === 'callout-1');
      expect(callout).toBeDefined();
      // Callout content must reference the paragraph AND both list items (3 total).
      expect(callout?.content).toHaveLength(3);

      const listBlocks = result.filter(b => b.type === 'list');
      expect(listBlocks).toHaveLength(2);
      // BOTH list items must be parented to the callout, not orphaned at root.
      for (const listBlock of listBlocks) {
        expect(listBlock.parent).toBe('callout-1');
      }
      // Their IDs must appear in callout.content.
      for (const listBlock of listBlocks) {
        expect(callout?.content).toContain(listBlock.id);
      }
      // Content text must be preserved for both items.
      const texts = listBlocks.map(b => (b.data as { text: string }).text);
      expect(texts).toContain('Убедись, что в раковине для посуды нет инвентаря;');
      expect(texts).toContain('Сполосни кружку проточной водой.');
    });

    it('recursively expands legacy callout nested inside a toggleList body', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'outer',
          type: 'toggleList',
          data: {
            title: 'Outer',
            body: {
              blocks: [
                {
                  id: 'innerCallout',
                  type: 'callout',
                  data: {
                    body: {
                      blocks: [
                        { id: 'cp', type: 'paragraph', data: { text: 'inside callout' } },
                      ],
                    },
                    variant: 'note',
                    emoji: '💡',
                    isEmojiVisible: true,
                  },
                },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const callout = result.find(b => b.id === 'innerCallout');
      expect(callout).toBeDefined();
      expect(callout?.type).toBe('callout');
      // Legacy 'body' field must have been stripped in favor of hierarchical refs.
      expect((callout?.data as Record<string, unknown>).body).toBeUndefined();
      expect(callout?.parent).toBe('outer');
      expect(callout?.content).toEqual(['cp']);
      const cp = result.find(b => b.id === 'cp');
      expect(cp?.parent).toBe('innerCallout');
    });

    it('handles mixed list and toggleList blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [{ content: 'list item' }],
          },
        },
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Toggle',
            body: {
              blocks: [
                { id: 'c1', type: 'paragraph', data: { text: 'toggle child' } },
              ],
            },
          },
        },
        { id: 'p1', type: 'paragraph', data: { text: 'plain paragraph' } },
      ];

      const result = expandToHierarchical(blocks);

      // List block expands to list items
      const listBlocks = result.filter(b => b.type === 'list');
      expect(listBlocks.length).toBeGreaterThan(0);

      // Toggle block expands
      const toggleBlocks = result.filter(b => b.type === 'toggle');
      expect(toggleBlocks).toHaveLength(1);
      expect(toggleBlocks[0].data.text).toBe('Toggle');

      // Toggle children
      const toggleChildren = result.filter(b => b.parent === 't1');
      expect(toggleChildren).toHaveLength(1);

      // Plain paragraph passes through
      const paragraphs = result.filter(b => b.type === 'paragraph');
      expect(paragraphs.some(p => p.data.text === 'plain paragraph')).toBe(true);
    });

    it('preserves tunes on expanded toggle block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Toggle with tunes',
            body: { blocks: [] },
          },
          tunes: { alignment: { align: 'center' } },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].tunes).toEqual({ alignment: { align: 'center' } });
    });

    it('expands toggleList with titleVariant into a toggle heading header block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Section heading',
            titleVariant: 2,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('header');
    });

    it('maps titleVariant to header level', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Section heading',
            titleVariant: 3,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.level).toBe(3);
    });

    it('sets isToggleable true on header block when titleVariant is present', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Section heading',
            titleVariant: 2,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.isToggleable).toBe(true);
    });

    it('maps title to text on toggle heading header block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'My Heading Toggle',
            titleVariant: 2,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.text).toBe('My Heading Toggle');
    });

    it('maps isExpanded to isOpen on toggle heading header block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Section heading',
            titleVariant: 2,
            isExpanded: false,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.isOpen).toBe(false);
    });

    it('sets body blocks as children of toggle heading header block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 't1',
          type: 'toggleList',
          data: {
            title: 'Section heading',
            titleVariant: 2,
            body: {
              blocks: [
                { id: 'c1', type: 'paragraph', data: { text: 'child text' } },
                { id: 'c2', type: 'paragraph', data: { text: 'more content' } },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result).toHaveLength(3);
      expect(result[0].content).toEqual(['c1', 'c2']);
      expect(result[1].parent).toBe('t1');
      expect(result[2].parent).toBe('t1');
    });

    it('generates IDs for blocks missing IDs', () => {
      const blocks: OutputBlockData[] = [
        {
          type: 'toggleList',
          data: {
            title: 'Toggle',
            body: {
              blocks: [
                { type: 'paragraph', data: { text: 'no id child' } },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      // Toggle block should have a generated ID
      expect(result[0].id).toBeDefined();
      expect(typeof result[0].id).toBe('string');

      // Child block should have a generated ID
      expect(result[1].id).toBeDefined();
      expect(typeof result[1].id).toBe('string');

      // Parent reference should match toggle ID
      expect(result[1].parent).toBe(result[0].id);

      // Content array should reference child ID
      expect(result[0].content).toEqual([result[1].id]);
    });
  });

  describe('expandToHierarchical - legacy callout', () => {
    it('expands legacy callout into callout parent + child blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'p1', type: 'paragraph', data: { text: 'child text' } },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('callout');
      expect(result[1].type).toBe('paragraph');
    });

    it('maps variant "note" to backgroundColor "blue"', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'note', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.backgroundColor).toBe('blue');
      expect(result[0].data.textColor).toBeNull();
    });

    it('maps variant "important" to backgroundColor "purple"', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'important', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.backgroundColor).toBe('purple');
    });

    it('maps variant "warning" to backgroundColor "orange"', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'warning', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.backgroundColor).toBe('orange');
    });

    it('maps variant "additional" to backgroundColor "yellow"', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'additional', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.backgroundColor).toBe('yellow');
    });

    it('maps variant "recommendation" to backgroundColor "green"', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'recommendation', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.backgroundColor).toBe('green');
    });

    it('maps variant "caution" to backgroundColor "red"', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'caution', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.backgroundColor).toBe('red');
    });

    it('maps variant "general" to backgroundColor null', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'general', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.backgroundColor).toBeNull();
    });

    it('maps isEmojiVisible false to empty emoji string', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'general', emoji: '💡', isEmojiVisible: false },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.emoji).toBe('');
    });

    it('maps isEmojiVisible true with null emoji to default emoji', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'general', emoji: null, isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.emoji).toBe('💡');
    });

    it('maps isEmojiVisible true with emoji string to that emoji', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'general', emoji: '🔥', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.emoji).toBe('🔥');
    });

    it('sets parent reference on child blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'p1', type: 'paragraph', data: { text: 'child 1' } },
                { id: 'p2', type: 'paragraph', data: { text: 'child 2' } },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[1].parent).toBe('c1');
      expect(result[2].parent).toBe('c1');
    });

    it('sets content array on callout block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'p1', type: 'paragraph', data: { text: 'child 1' } },
                { id: 'p2', type: 'paragraph', data: { text: 'child 2' } },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].content).toEqual(['p1', 'p2']);
    });

    it('handles callout with null body', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: null, variant: 'note', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('callout');
      expect(result[0].content).toBeUndefined();
    });

    it('handles callout with empty body blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'note', emoji: '💡', isEmojiVisible: true },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBeUndefined();
    });

    it('preserves tunes on expanded callout block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: { body: { blocks: [] }, variant: 'note', emoji: '💡', isEmojiVisible: true },
          tunes: { alignment: { align: 'center' } },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].tunes).toEqual({ alignment: { align: 'center' } });
    });

    it('discards title field during expansion', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'c1',
          type: 'callout',
          data: {
            title: 'Some Title',
            body: { blocks: [] },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      expect(result[0].data.title).toBeUndefined();
    });
  });

  describe('collapseToLegacy - toggle blocks', () => {
    it('collapses toggle + child blocks back to toggleList format', () => {
      const blocks: OutputBlockData[] = [
        { id: 't1', type: 'toggle', data: { text: 'Toggle heading', isOpen: true }, content: ['c1'] },
        { id: 'c1', type: 'paragraph', data: { text: 'child text' }, parent: 't1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('toggleList');
    });

    it('maps text back to title', () => {
      const blocks: OutputBlockData[] = [
        { id: 't1', type: 'toggle', data: { text: 'My Title' }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.title).toBe('My Title');
    });

    it('maps isOpen back to isExpanded', () => {
      const blocks: OutputBlockData[] = [
        { id: 't1', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.isExpanded).toBe(true);
    });

    it('collects child blocks into body.blocks', () => {
      const blocks: OutputBlockData[] = [
        { id: 't1', type: 'toggle', data: { text: 'Toggle' }, content: ['c1', 'c2'] },
        { id: 'c1', type: 'paragraph', data: { text: 'child 1' }, parent: 't1' },
        { id: 'c2', type: 'header', data: { text: 'heading', level: 2 }, parent: 't1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.body).toBeDefined();
      expect(result[0].data.body.blocks).toHaveLength(2);
      expect(result[0].data.body.blocks[0].type).toBe('paragraph');
      expect(result[0].data.body.blocks[1].type).toBe('header');
    });

    it('strips parent/content from collapsed child blocks', () => {
      const blocks: OutputBlockData[] = [
        { id: 't1', type: 'toggle', data: { text: 'Toggle' }, content: ['c1'] },
        { id: 'c1', type: 'paragraph', data: { text: 'child' }, parent: 't1' },
      ];

      const result = collapseToLegacy(blocks);

      const childBlocks = result[0].data.body.blocks;

      expect(childBlocks[0].parent).toBeUndefined();
      expect(childBlocks[0].content).toBeUndefined();
    });

    it('handles toggle with no children', () => {
      const blocks: OutputBlockData[] = [
        { id: 't1', type: 'toggle', data: { text: 'Empty toggle' } },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('toggleList');
      expect(result[0].data.title).toBe('Empty toggle');
      expect(result[0].data.body).toBeUndefined();
    });

    it('collapses toggleable header into toggleList with titleVariant', () => {
      const blocks: OutputBlockData[] = [
        { id: 'h1', type: 'header', data: { text: 'Section heading', level: 2, isToggleable: true }, content: ['c1'] },
        { id: 'c1', type: 'paragraph', data: { text: 'child text' }, parent: 'h1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('toggleList');
      expect(result[0].data.titleVariant).toBe(2);
    });

    it('maps toggleable header text to title in collapsed toggleList', () => {
      const blocks: OutputBlockData[] = [
        { id: 'h1', type: 'header', data: { text: 'My Section', level: 3, isToggleable: true } },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.title).toBe('My Section');
    });

    it('maps toggleable header isOpen to isExpanded in collapsed toggleList', () => {
      const blocks: OutputBlockData[] = [
        { id: 'h1', type: 'header', data: { text: 'Section', level: 2, isToggleable: true, isOpen: false } },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.isExpanded).toBe(false);
    });

    it('collects toggleable header children into body.blocks', () => {
      const blocks: OutputBlockData[] = [
        { id: 'h1', type: 'header', data: { text: 'Section', level: 2, isToggleable: true }, content: ['c1', 'c2'] },
        { id: 'c1', type: 'paragraph', data: { text: 'first child' }, parent: 'h1' },
        { id: 'c2', type: 'paragraph', data: { text: 'second child' }, parent: 'h1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.body.blocks).toHaveLength(2);
      expect(result[0].data.body.blocks[0].data.text).toBe('first child');
    });

    it('handles toggleable header with no children in collapse', () => {
      const blocks: OutputBlockData[] = [
        { id: 'h1', type: 'header', data: { text: 'Empty section', level: 2, isToggleable: true } },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('toggleList');
      expect(result[0].data.title).toBe('Empty section');
      expect(result[0].data.titleVariant).toBe(2);
      expect(result[0].data.body).toBeUndefined();
    });

    it('handles mixed list and toggle blocks in collapse', () => {
      const blocks: OutputBlockData[] = [
        { id: 'l1', type: 'list', data: { text: 'List item', style: 'unordered' } },
        { id: 't1', type: 'toggle', data: { text: 'Toggle' }, content: ['c1'] },
        { id: 'c1', type: 'paragraph', data: { text: 'toggle child' }, parent: 't1' },
        { id: 'p1', type: 'paragraph', data: { text: 'plain paragraph' } },
      ];

      const result = collapseToLegacy(blocks);

      // List block should be collapsed to legacy list format
      const listBlocks = result.filter(b => b.type === 'list');
      expect(listBlocks.length).toBeGreaterThan(0);

      // Toggle block should be collapsed to toggleList format
      const toggleBlocks = result.filter(b => b.type === 'toggleList');
      expect(toggleBlocks).toHaveLength(1);
      expect(toggleBlocks[0].data.title).toBe('Toggle');

      // Plain paragraph passes through
      const paragraphs = result.filter(b => b.type === 'paragraph');
      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0].data.text).toBe('plain paragraph');
    });
  });

  describe('collapseToLegacy - callout blocks', () => {
    it('collapses callout + child blocks back to legacy callout format', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' }, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'child text' }, parent: 'c1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('callout');
    });

    it('maps backgroundColor "blue" back to variant "note"', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.variant).toBe('note');
    });

    it('maps backgroundColor "purple" back to variant "important"', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'purple' }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.variant).toBe('important');
    });

    it('maps backgroundColor "orange" back to variant "warning"', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'orange' }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.variant).toBe('warning');
    });

    it('maps backgroundColor "yellow" back to variant "additional"', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'yellow' }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.variant).toBe('additional');
    });

    it('maps backgroundColor "green" back to variant "recommendation"', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'green' }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.variant).toBe('recommendation');
    });

    it('maps backgroundColor "red" back to variant "caution"', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'red' }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.variant).toBe('caution');
    });

    it('maps backgroundColor null back to variant "general"', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.variant).toBe('general');
    });

    it('maps unknown backgroundColor to variant "general"', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'pink' }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.variant).toBe('general');
    });

    it('maps empty emoji to isEmojiVisible false and emoji null', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.isEmojiVisible).toBe(false);
      expect(result[0].data.emoji).toBeNull();
    });

    it('maps non-empty emoji to isEmojiVisible true and emoji string', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '🔥', textColor: null, backgroundColor: null }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.isEmojiVisible).toBe(true);
      expect(result[0].data.emoji).toBe('🔥');
    });

    it('collects child blocks into body.blocks', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' }, content: ['p1', 'p2'] },
        { id: 'p1', type: 'paragraph', data: { text: 'child 1' }, parent: 'c1' },
        { id: 'p2', type: 'header', data: { text: 'heading', level: 2 }, parent: 'c1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.body).toBeDefined();
      expect(result[0].data.body.blocks).toHaveLength(2);
      expect(result[0].data.body.blocks[0].type).toBe('paragraph');
      expect(result[0].data.body.blocks[1].type).toBe('header');
    });

    it('strips parent/content from collapsed child blocks', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'child' }, parent: 'c1' },
      ];

      const result = collapseToLegacy(blocks);

      const childBlocks = result[0].data.body.blocks;

      expect(childBlocks[0].parent).toBeUndefined();
      expect(childBlocks[0].content).toBeUndefined();
    });

    it('handles callout with no children', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' } },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('callout');
      expect(result[0].data.variant).toBe('note');
      expect(result[0].data.body).toBeUndefined();
    });

    it('preserves tunes on collapsed callout block', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, tunes: { alignment: { align: 'left' } } },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].tunes).toEqual({ alignment: { align: 'left' } });
    });

    it('sets title to empty string in collapsed output', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: [] },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.title).toBe('');
    });

    /**
     * Defense-in-depth regression for the callout paste bug: even if upstream
     * persistence passes us OutputBlockData with a stale or missing `content[]`
     * on the parent, children carrying `parent: X` must NOT be ejected from the
     * legacy body. Saver is the primary fix; this layer is a safety net for any
     * code path that constructs OutputBlockData without running the saver
     * reconciliation (external JSON, migrations, tests, 3rd-party consumers).
     */
    it('keeps callout children when content[] is missing but parent fields are set', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null } },
        { id: 'h1', type: 'header', data: { text: 'Исключения', level: 4 }, parent: 'c1' },
        { id: 'p1', type: 'paragraph', data: { text: '1. Item' }, parent: 'c1' },
        { id: 'p2', type: 'paragraph', data: { text: '2. Item' }, parent: 'c1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('callout');
      const body = result[0].data.body;

      expect(body).toBeDefined();
      expect(body.blocks).toHaveLength(3);
      expect(body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['h1', 'p1', 'p2']);
    });

    it('keeps callout children when content[] is stale (partial list)', () => {
      const blocks: OutputBlockData[] = [
        // content only names h1 — p1 and p2 are missing from the stale list
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['h1'] },
        { id: 'h1', type: 'header', data: { text: 'Исключения', level: 4 }, parent: 'c1' },
        { id: 'p1', type: 'paragraph', data: { text: '1. Item' }, parent: 'c1' },
        { id: 'p2', type: 'paragraph', data: { text: '2. Item' }, parent: 'c1' },
      ];

      const result = collapseToLegacy(blocks);

      // Stale content[] must not cause paragraphs to get ejected as root siblings.
      expect(result).toHaveLength(1);
      expect(result[0].data.body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['h1', 'p1', 'p2']);
    });

    it('drops dead ids from content[] when block is missing from input', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['ghost', 'h1'] },
        { id: 'h1', type: 'header', data: { text: 'T', level: 4 }, parent: 'c1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.body.blocks).toHaveLength(1);
      expect(result[0].data.body.blocks[0].id).toBe('h1');
    });

    /**
     * Generic container reconciliation: the same paste-ejection drift that hit
     * callout can hit ANY container block (toggle, toggleable header, nested
     * list) because processRootToggleItem / processRootToggleableHeader /
     * processRootListItem all read `block.content ?? []` as authoritative. The
     * defense-in-depth reconcile pass at the head of collapseToLegacy is generic
     * (keyed on `block.parent`, not on container type), so toggle, header, and
     * list must behave the same as callout under stale-content drift. These
     * tests lock the generic contract so no future refactor can silently make
     * the reconcile callout-specific and leave other containers unprotected.
     */
    it('keeps toggle children when content[] is missing but parent fields are set', () => {
      const blocks: OutputBlockData[] = [
        { id: 't1', type: 'toggle', data: { text: 'Group', isOpen: true } },
        { id: 'p1', type: 'paragraph', data: { text: 'Pasted 1' }, parent: 't1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Pasted 2' }, parent: 't1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('toggleList');
      expect(result[0].data.body).toBeDefined();
      expect(result[0].data.body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['p1', 'p2']);
    });

    it('keeps toggle children when content[] is stale (partial list)', () => {
      const blocks: OutputBlockData[] = [
        // content only names p1 — p2 and p3 missing from the stale list
        { id: 't1', type: 'toggle', data: { text: 'Group', isOpen: true }, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
        { id: 'p2', type: 'paragraph', data: { text: 'two' }, parent: 't1' },
        { id: 'p3', type: 'paragraph', data: { text: 'three' }, parent: 't1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].data.body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('keeps toggleable-header children when content[] is missing but parent fields are set', () => {
      const blocks: OutputBlockData[] = [
        { id: 'h1', type: 'header', data: { text: 'Section', level: 2, isToggleable: true, isOpen: true } },
        { id: 'p1', type: 'paragraph', data: { text: 'Pasted body 1' }, parent: 'h1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Pasted body 2' }, parent: 'h1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('toggleList');
      expect(result[0].data.body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['p1', 'p2']);
    });

    it('keeps toggleable-header children when content[] is stale (partial list)', () => {
      const blocks: OutputBlockData[] = [
        { id: 'h1', type: 'header', data: { text: 'Section', level: 2, isToggleable: true, isOpen: true }, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'a' }, parent: 'h1' },
        { id: 'p2', type: 'paragraph', data: { text: 'b' }, parent: 'h1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result[0].data.body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['p1', 'p2']);
    });

    it('keeps nested flat-list children when content[] is missing but parent fields are set', () => {
      const blocks: OutputBlockData[] = [
        { id: 'l1', type: 'list', data: { style: 'unordered', text: 'root' } },
        { id: 'l2', type: 'list', data: { style: 'unordered', text: 'child one' }, parent: 'l1' },
        { id: 'l3', type: 'list', data: { style: 'unordered', text: 'child two' }, parent: 'l1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('list');
      const items = result[0].data.items;

      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('root');
      expect(items[0].items).toHaveLength(2);
      expect(items[0].items[0].content).toBe('child one');
      expect(items[0].items[1].content).toBe('child two');
    });

    it('reconciles mixed container types in one pass without cross-contamination', () => {
      // Three different containers coexist with stale/missing content[]. The
      // generic reconcile must keep each container's children scoped to the
      // right parent — no bleed-over between callout, toggle, and header.
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null } },
        { id: 'cp1', type: 'paragraph', data: { text: 'callout kid' }, parent: 'c1' },
        { id: 't1', type: 'toggle', data: { text: 'toggle title', isOpen: true } },
        { id: 'tp1', type: 'paragraph', data: { text: 'toggle kid' }, parent: 't1' },
        { id: 'h1', type: 'header', data: { text: 'header title', level: 3, isToggleable: true } },
        { id: 'hp1', type: 'paragraph', data: { text: 'header kid' }, parent: 'h1' },
      ];

      const result = collapseToLegacy(blocks);

      expect(result).toHaveLength(3);

      const callout = result.find(b => b.id === 'c1');
      const toggle = result.find(b => b.id === 't1');
      const header = result.find(b => b.id === 'h1');

      expect(callout?.data.body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['cp1']);
      expect(toggle?.data.body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['tp1']);
      expect(header?.data.body.blocks.map((b: OutputBlockData) => b.id)).toEqual(['hp1']);
    });
  });

  describe('normalizeTableChildParents', () => {
    /**
     * Regression: dodopizza.info articles save tables in a flat-array shape where
     * the table block references its children via `data.content[r][c].blocks = [<id>]`
     * but the referenced child blocks DO NOT carry a `parent` field. Without
     * normalization, the renderer composes those children with parentId=undefined
     * and the read-only table mounter (which gates on parentId === tableBlockId)
     * skips them — so they leak out of the table and render at the bottom of the page.
     */
    it('assigns parent to children referenced inside table cells', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'tbl-1',
          type: 'table',
          data: {
            withHeadings: false,
            content: [
              [{ blocks: ['child-a'] }, { blocks: ['child-b'] }],
              [{ blocks: ['child-c'] }, { blocks: ['child-d'] }],
            ],
          },
        },
        { id: 'child-a', type: 'paragraph', data: { text: 'A' } },
        { id: 'child-b', type: 'paragraph', data: { text: 'B' } },
        { id: 'child-c', type: 'paragraph', data: { text: 'C' } },
        { id: 'child-d', type: 'paragraph', data: { text: 'D' } },
      ];

      const result = normalizeTableChildParents(blocks);

      expect(result.find(b => b.id === 'child-a')?.parent).toBe('tbl-1');
      expect(result.find(b => b.id === 'child-b')?.parent).toBe('tbl-1');
      expect(result.find(b => b.id === 'child-c')?.parent).toBe('tbl-1');
      expect(result.find(b => b.id === 'child-d')?.parent).toBe('tbl-1');
    });

    it('leaves the table block itself untouched', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'tbl-1',
          type: 'table',
          data: { content: [[{ blocks: ['child-a'] }]] },
        },
        { id: 'child-a', type: 'paragraph', data: { text: 'A' } },
      ];

      const result = normalizeTableChildParents(blocks);

      expect(result.find(b => b.id === 'tbl-1')?.parent).toBeUndefined();
    });

    it('does not overwrite an explicit parent already set on a child', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'tbl-1',
          type: 'table',
          data: { content: [[{ blocks: ['child-a'] }]] },
        },
        { id: 'child-a', type: 'paragraph', data: { text: 'A' }, parent: 'some-other-parent' },
      ];

      const result = normalizeTableChildParents(blocks);

      expect(result.find(b => b.id === 'child-a')?.parent).toBe('some-other-parent');
    });

    it('does not crash when a referenced child is missing from the array', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'tbl-1',
          type: 'table',
          data: { content: [[{ blocks: ['ghost-id'] }]] },
        },
        { id: 'p1', type: 'paragraph', data: { text: 'p' } },
      ];

      expect(() => normalizeTableChildParents(blocks)).not.toThrow();

      const result = normalizeTableChildParents(blocks);

      expect(result.find(b => b.id === 'p1')?.parent).toBeUndefined();
    });

    it('ignores legacy string cells (no blocks references)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'tbl-1',
          type: 'table',
          data: { content: [['plain text', 'more text']] },
        },
        { id: 'p1', type: 'paragraph', data: { text: 'unrelated' } },
      ];

      const result = normalizeTableChildParents(blocks);

      expect(result.find(b => b.id === 'p1')?.parent).toBeUndefined();
    });

    it('returns the same array reference when there are no table refs to normalize', () => {
      const blocks: OutputBlockData[] = [
        { id: 'p1', type: 'paragraph', data: { text: 'A' } },
        { id: 'p2', type: 'paragraph', data: { text: 'B' } },
      ];

      const result = normalizeTableChildParents(blocks);

      expect(result).toBe(blocks);
    });

    it('does not mutate the input blocks array', () => {
      const child = { id: 'child-a', type: 'paragraph', data: { text: 'A' } } as OutputBlockData;
      const blocks: OutputBlockData[] = [
        { id: 'tbl-1', type: 'table', data: { content: [[{ blocks: ['child-a'] }]] } },
        child,
      ];

      const before = JSON.stringify(blocks);

      normalizeTableChildParents(blocks);

      expect(JSON.stringify(blocks)).toBe(before);
      expect(child.parent).toBeUndefined();
    });

    it('assigns child to the first table in document order when two tables reference the same child (cross-table duplicate)', () => {
      // Regression coverage for the dodopizza article bug: block rGvmRJP10H was
      // listed in both table EcpQotB04_ and table oGx-emyH_h. First-writer-wins
      // means the block's parent becomes the first table encountered in doc
      // order. The second table's data.content still lists the id, but the
      // save-time parent filter in Table.save() drops it.
      const blocks: OutputBlockData[] = [
        {
          id: 'tbl-first',
          type: 'table',
          data: { content: [[{ blocks: ['shared-child'] }]] },
        },
        {
          id: 'tbl-second',
          type: 'table',
          data: { content: [[{ blocks: ['shared-child'] }]] },
        },
        { id: 'shared-child', type: 'paragraph', data: { text: 'X' } },
      ];

      const result = normalizeTableChildParents(blocks);

      expect(result.find(b => b.id === 'shared-child')?.parent).toBe('tbl-first');
    });

    it('keeps null/undefined-id table blocks safe (skipped, not crashing)', () => {
      const blocks: OutputBlockData[] = [
        // table block without an id — cannot be a parent target
        { type: 'table', data: { content: [[{ blocks: ['child-a'] }]] } } as OutputBlockData,
        { id: 'child-a', type: 'paragraph', data: { text: 'A' } },
      ];

      const result = normalizeTableChildParents(blocks);

      expect(result.find(b => b.id === 'child-a')?.parent).toBeUndefined();
    });
  });

  /**
   * Exhaustive regression matrix for the "multi-item legacy list inside legacy
   * container body" bug. The original bug dropped items 2..N to document root
   * because `expandLegacyBodyBlocks` only re-parented the first emitted block.
   * Every case below MUST keep all N items as descendants of the container.
   */
  describe('expandLegacyBodyBlocks regression matrix', () => {
    const assertAllListItemsParentedTo = (
      result: OutputBlockData[],
      containerId: BlockId,
      expectedTexts: string[]
    ): void => {
      const container = result.find(b => b.id === containerId);

      expect(container).toBeDefined();

      const listBlocks = result.filter(b => b.type === 'list' && b.parent === containerId);

      expect(listBlocks).toHaveLength(expectedTexts.length);

      const texts = listBlocks.map(b => (b.data as { text: string }).text);

      for (const expected of expectedTexts) {
        expect(texts).toContain(expected);
      }

      for (const listBlock of listBlocks) {
        expect(container?.content).toContain(listBlock.id);
      }

      const orphanListBlocks = result.filter(
        b => b.type === 'list' && b.parent === undefined
      );

      expect(orphanListBlocks).toHaveLength(0);
    };

    it('multi-item unordered string list inside toggleList body', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'toggle-1',
          type: 'toggleList',
          data: {
            title: 'Outer toggle',
            body: {
              blocks: [
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: ['t1', 't2', 't3'],
                  },
                },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      assertAllListItemsParentedTo(result, 'toggle-1', ['t1', 't2', 't3']);
    });

    it('multi-item list inside toggleable-header body (titleVariant set)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'toggle-header-1',
          type: 'toggleList',
          data: {
            title: 'Toggle heading',
            titleVariant: 2,
            body: {
              blocks: [
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: ['a', 'b'],
                  },
                },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const header = result.find(b => b.id === 'toggle-header-1');

      expect(header?.type).toBe('header');
      expect(header?.data.isToggleable).toBe(true);
      assertAllListItemsParentedTo(result, 'toggle-header-1', ['a', 'b']);
    });

    it('3+ item list stays parented (no off-by-one)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: ['i1', 'i2', 'i3', 'i4', 'i5'],
                  },
                },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      assertAllListItemsParentedTo(result, 'callout-1', ['i1', 'i2', 'i3', 'i4', 'i5']);
    });

    it('mixed body: paragraph + two sequential multi-item lists', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'p1', type: 'paragraph', data: { text: 'intro' } },
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: ['a1', 'a2'],
                  },
                },
                { id: 'p2', type: 'paragraph', data: { text: 'middle' } },
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: ['b1', 'b2', 'b3'],
                  },
                },
              ],
            },
            variant: 'info',
            emoji: 'ℹ️',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const callout = result.find(b => b.id === 'callout-1');

      // 2 paragraphs + 2 + 3 list items = 7 direct children.
      expect(callout?.content).toHaveLength(7);

      const listBlocks = result.filter(b => b.type === 'list');

      expect(listBlocks).toHaveLength(5);
      for (const listBlock of listBlocks) {
        expect(listBlock.parent).toBe('callout-1');
        expect(callout?.content).toContain(listBlock.id);
      }
    });

    it('object-form items ({content}) inside callout', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: [
                      { content: 'alpha' },
                      { content: 'beta' },
                    ],
                  },
                },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      assertAllListItemsParentedTo(result, 'callout-1', ['alpha', 'beta']);
    });

    it('old checklist items ({text, checked}) inside callout', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                {
                  type: 'list',
                  data: {
                    style: 'checklist',
                    items: [
                      { text: 'done', checked: true },
                      { text: 'todo', checked: false },
                    ],
                  },
                },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const callout = result.find(b => b.id === 'callout-1');
      const listBlocks = result.filter(b => b.type === 'list' && b.parent === 'callout-1');

      expect(listBlocks).toHaveLength(2);

      const doneItem = listBlocks.find(b => (b.data as { text: string }).text === 'done');
      const todoItem = listBlocks.find(b => (b.data as { text: string }).text === 'todo');

      expect((doneItem?.data as { checked: boolean }).checked).toBe(true);
      expect((todoItem?.data as { checked: boolean }).checked).toBe(false);
      expect(callout?.content).toContain(doneItem?.id);
      expect(callout?.content).toContain(todoItem?.id);
    });

    it('ordered list with start > 1 inside callout', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                {
                  type: 'list',
                  data: {
                    style: 'ordered',
                    start: 5,
                    items: ['step 5', 'step 6'],
                  },
                },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const callout = result.find(b => b.id === 'callout-1');
      const listBlocks = result.filter(b => b.type === 'list' && b.parent === 'callout-1');

      expect(listBlocks).toHaveLength(2);

      const firstItem = listBlocks.find(b => (b.data as { text: string }).text === 'step 5');

      // start flag lives on the first root ordered item only.
      expect((firstItem?.data as { start?: number }).start).toBe(5);
      expect(callout?.content).toHaveLength(2);
    });

    it('nested list items (items with children) inside callout', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: [
                      {
                        content: 'parent A',
                        items: [
                          { content: 'child A.1' },
                          { content: 'child A.2' },
                        ],
                      },
                      { content: 'parent B' },
                    ],
                  },
                },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const callout = result.find(b => b.id === 'callout-1');

      // Root list items (parent A, parent B) must be callout children.
      const rootListItems = result.filter(
        b => b.type === 'list' && b.parent === 'callout-1'
      );

      expect(rootListItems).toHaveLength(2);

      const parentA = rootListItems.find(b => (b.data as { text: string }).text === 'parent A');
      const parentB = rootListItems.find(b => (b.data as { text: string }).text === 'parent B');

      expect(parentA).toBeDefined();
      expect(parentB).toBeDefined();
      expect(callout?.content).toContain(parentA?.id);
      expect(callout?.content).toContain(parentB?.id);

      // Nested children must be parented to parent A, not orphaned.
      const nestedChildren = result.filter(
        b => b.type === 'list' && b.parent === parentA?.id
      );

      expect(nestedChildren).toHaveLength(2);

      const nestedTexts = nestedChildren.map(b => (b.data as { text: string }).text);

      expect(nestedTexts).toContain('child A.1');
      expect(nestedTexts).toContain('child A.2');
    });

    it('deeply nested: multi-item list inside callout inside toggleList', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'toggle-1',
          type: 'toggleList',
          data: {
            title: 'Outer',
            body: {
              blocks: [
                {
                  id: 'callout-1',
                  type: 'callout',
                  data: {
                    body: {
                      blocks: [
                        {
                          type: 'list',
                          data: {
                            style: 'unordered',
                            items: ['x', 'y', 'z'],
                          },
                        },
                      ],
                    },
                    variant: 'note',
                    emoji: '💡',
                    isEmojiVisible: true,
                  },
                },
              ],
            },
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const toggle = result.find(b => b.id === 'toggle-1');
      const callout = result.find(b => b.id === 'callout-1');

      expect(toggle?.content).toEqual(['callout-1']);
      expect(callout?.parent).toBe('toggle-1');
      assertAllListItemsParentedTo(result, 'callout-1', ['x', 'y', 'z']);
    });

    it('round-trip: expand → collapse → expand produces stable output', () => {
      const original: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                { id: 'p1', type: 'paragraph', data: { text: 'intro' } },
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: ['rt1', 'rt2', 'rt3'],
                  },
                },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const firstExpand = expandToHierarchical(original);
      const collapsed = collapseToLegacy(firstExpand);
      const secondExpand = expandToHierarchical(collapsed);

      const calloutFirst = firstExpand.find(b => b.id === 'callout-1');
      const calloutSecond = secondExpand.find(b => b.id === 'callout-1');

      expect(calloutFirst?.content?.length).toBe(calloutSecond?.content?.length);

      const firstListTexts = firstExpand
        .filter(b => b.type === 'list' && b.parent === 'callout-1')
        .map(b => (b.data as { text: string }).text)
        .sort();
      const secondListTexts = secondExpand
        .filter(b => b.type === 'list' && b.parent === 'callout-1')
        .map(b => (b.data as { text: string }).text)
        .sort();

      expect(secondListTexts).toEqual(firstListTexts);
      expect(secondListTexts).toEqual(['rt1', 'rt2', 'rt3']);

      const orphansFirst = firstExpand.filter(b => b.type === 'list' && b.parent === undefined);
      const orphansSecond = secondExpand.filter(b => b.type === 'list' && b.parent === undefined);

      expect(orphansFirst).toHaveLength(0);
      expect(orphansSecond).toHaveLength(0);
    });

    it('legacy list block without an explicit id still gets every item re-parented', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                // No id on the list block — expansion must mint ids and still parent all.
                {
                  type: 'list',
                  data: {
                    style: 'unordered',
                    items: ['first', 'second'],
                  },
                },
              ],
            },
            variant: 'note',
            emoji: '💡',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      assertAllListItemsParentedTo(result, 'callout-1', ['first', 'second']);
    });

    it('exact dodois "в свою кружку" article shape round-trips without orphans', () => {
      // Shape copied from production API (c23b8bf4-d68c-11f0-b1ee-6045bda1eb80).
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: {
            body: {
              blocks: [
                {
                  type: 'paragraph',
                  data: {
                    text: 'Если ты заметил, что в кружке Гостя есть остатки напитка или она выглядит грязной:',
                  },
                },
                {
                  type: 'list',
                  data: {
                    items: [
                      'Убедись, что в раковине для посуды нет инвентаря;',
                      'Сполосни кружку проточной водой, можешь использовать одноразовую белую тряпку и средство для ручного мытья посуды Assert Lemon для более тщательного промывания.',
                    ],
                    style: 'unordered',
                  },
                },
              ],
            },
            emoji: 'ℹ️',
            title: '',
            variant: 'info',
            isEmojiVisible: true,
          },
        },
      ];

      const result = expandToHierarchical(blocks);

      const callout = result.find(b => b.id === 'callout-1');

      // 1 paragraph + 2 list items = 3 direct descendants.
      expect(callout?.content).toHaveLength(3);

      const listItems = result.filter(b => b.type === 'list');

      expect(listItems).toHaveLength(2);
      for (const li of listItems) {
        expect(li.parent).toBe('callout-1');
        expect(callout?.content).toContain(li.id);
      }

      // Orphan guard: zero root-level list blocks must exist outside the callout.
      const rootListBlocks = result.filter(b => b.type === 'list' && b.parent === undefined);

      expect(rootListBlocks).toHaveLength(0);
    });
  });

  describe('collapseToLegacy deep-nesting regression (grandchildren preservation)', () => {
    /**
     * Guards against the mirror of the expand-side bug: processRoot{Callout,Toggle,
     * ToggleableHeader}Item previously only copied direct children via
     * stripHierarchyFields, so grandchildren were ejected to the document root
     * (or silently dropped when the outer loop could not classify them).
     */
    it('preserves paragraph grandchild nested in flat callout → toggle → paragraph', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: { title: '', variant: 'info', emoji: null, isEmojiVisible: false },
          content: ['toggle-1'],
        },
        {
          id: 'toggle-1',
          type: 'toggle',
          data: { text: 'Outer toggle', isOpen: true },
          parent: 'callout-1',
          content: ['para-1'],
        },
        {
          id: 'para-1',
          type: 'paragraph',
          data: { text: 'Grandchild paragraph' },
          parent: 'toggle-1',
        },
      ];

      const result = collapseToLegacy(blocks);

      const rootCallout = result.find(b => b.id === 'callout-1');

      expect(rootCallout).toBeDefined();
      expect(rootCallout?.type).toBe('callout');

      const calloutBody = (rootCallout?.data as { body?: { blocks: OutputBlockData[] } }).body;

      expect(calloutBody?.blocks).toHaveLength(1);

      const innerToggle = calloutBody?.blocks[0];

      expect(innerToggle?.type).toBe('toggleList');

      const innerBody = (innerToggle?.data as { body?: { blocks: OutputBlockData[] } }).body;

      expect(innerBody?.blocks).toHaveLength(1);
      expect(innerBody?.blocks[0].type).toBe('paragraph');
      expect((innerBody?.blocks[0].data as { text: string }).text).toBe('Grandchild paragraph');

      // Grandchild must NOT appear as root sibling of the callout.
      const rootParagraphs = result.filter(b => b.type === 'paragraph');

      expect(rootParagraphs).toHaveLength(0);
    });

    it('collapses flat list (with nested child) inside callout body into legacy list shape', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'callout-1',
          type: 'callout',
          data: { title: '', variant: 'info', emoji: null, isEmojiVisible: false },
          content: ['list-1'],
        },
        {
          id: 'list-1',
          type: 'list',
          data: { text: 'Root item', style: 'unordered', checked: false, depth: 0 },
          parent: 'callout-1',
          content: ['list-2'],
        },
        {
          id: 'list-2',
          type: 'list',
          data: { text: 'Nested item', style: 'unordered', checked: false, depth: 1 },
          parent: 'list-1',
        },
      ];

      const result = collapseToLegacy(blocks);

      const rootCallout = result.find(b => b.id === 'callout-1');

      expect(rootCallout).toBeDefined();

      const body = (rootCallout?.data as { body?: { blocks: OutputBlockData[] } }).body;

      expect(body?.blocks).toHaveLength(1);

      const legacyList = body?.blocks[0];

      expect(legacyList?.type).toBe('list');

      const items = (legacyList?.data as { items: Array<{ content: string; items?: Array<{ content: string }> }> }).items;

      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Root item');
      expect(items[0].items).toHaveLength(1);
      expect(items[0].items?.[0].content).toBe('Nested item');

      // Grandchild list must not leak to root.
      const rootLists = result.filter(b => b.type === 'list' && b.id !== 'callout-1');

      expect(rootLists).toHaveLength(0);
    });

    it('preserves grandchildren under toggleable-header (titleVariant path)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'h-1',
          type: 'header',
          data: { text: 'Outer', level: 2, isToggleable: true, isOpen: true },
          content: ['toggle-2'],
        },
        {
          id: 'toggle-2',
          type: 'toggle',
          data: { text: 'Inner toggle', isOpen: true },
          parent: 'h-1',
          content: ['para-2'],
        },
        {
          id: 'para-2',
          type: 'paragraph',
          data: { text: 'Deep content' },
          parent: 'toggle-2',
        },
      ];

      const result = collapseToLegacy(blocks);

      const rootHeader = result.find(b => b.id === 'h-1');

      expect(rootHeader?.type).toBe('toggleList');

      const outerBody = (rootHeader?.data as { body?: { blocks: OutputBlockData[] } }).body;

      expect(outerBody?.blocks).toHaveLength(1);

      const innerToggle = outerBody?.blocks[0];

      expect(innerToggle?.type).toBe('toggleList');

      const innerBody = (innerToggle?.data as { body?: { blocks: OutputBlockData[] } }).body;

      expect(innerBody?.blocks).toHaveLength(1);
      expect((innerBody?.blocks[0].data as { text: string }).text).toBe('Deep content');

      const rootParagraphs = result.filter(b => b.type === 'paragraph');

      expect(rootParagraphs).toHaveLength(0);
    });

    it('round-trip: expand(collapse(flat callout → toggle → para)) is stable', () => {
      const flat: OutputBlockData[] = [
        {
          id: 'c-1',
          type: 'callout',
          data: { title: '', variant: 'info', emoji: null, isEmojiVisible: false },
          content: ['t-1'],
        },
        {
          id: 't-1',
          type: 'toggle',
          data: { text: 'T', isOpen: true },
          parent: 'c-1',
          content: ['p-1'],
        },
        {
          id: 'p-1',
          type: 'paragraph',
          data: { text: 'P' },
          parent: 't-1',
        },
      ];

      const legacy = collapseToLegacy(flat);
      const reExpanded = expandToHierarchical(legacy);

      // Re-expanded set must contain the 3 blocks, with parents preserved.
      expect(reExpanded).toHaveLength(3);

      const callout = reExpanded.find(b => b.type === 'callout');
      const toggle = reExpanded.find(b => b.type === 'toggle');
      const para = reExpanded.find(b => b.type === 'paragraph');

      expect(callout?.parent).toBeUndefined();
      expect(toggle?.parent).toBe(callout?.id);
      expect(para?.parent).toBe(toggle?.id);
      expect((para?.data as { text: string }).text).toBe('P');
    });
  });
});
