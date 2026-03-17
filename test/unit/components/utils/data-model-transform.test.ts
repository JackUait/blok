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
});
