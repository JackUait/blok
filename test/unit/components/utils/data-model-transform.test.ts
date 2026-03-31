import { describe, it, expect } from 'vitest';
import { analyzeDataFormat, expandToHierarchical, collapseToLegacy } from '../../../../src/components/utils/data-model-transform';
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
  });
});
