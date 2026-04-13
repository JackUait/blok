import { describe, it, expect } from 'vitest';
import { analyzeDataFormat, expandToHierarchical, collapseToLegacy, normalizeTableChildParents } from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';

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
});
