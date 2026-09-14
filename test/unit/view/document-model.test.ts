// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { blocksToMarkdown, blocksToPlainText } from '../../../src/view';
import { buildDocumentModel } from '../../../src/view/document-model';

/**
 * The Saver writes containment on BOTH sides: the container gets
 * `content: [childIds]` and the child gets `parent`. Documents that carry only
 * the `content[]` side (older stored articles, and the flat shape KB prompts an
 * LLM to emit) used to lose every child out of its container.
 */
describe('buildDocumentModel resolves containment from a container `content[]`', () => {
  it('claims a child that only the container names', () => {
    const model = buildDocumentModel({
      blocks: [
        { id: 'c1', type: 'callout', data: { emoji: '💡' }, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'inside' } },
      ],
    });

    expect(model.topLevel.map((block) => block.id)).toEqual(['c1']);
    expect(model.childrenOf('c1').map((block) => block.id)).toEqual(['p1']);
  });

  it('keeps an explicit `parent` authoritative over a conflicting `content[]`', () => {
    const model = buildDocumentModel({
      blocks: [
        { id: 'c1', type: 'callout', data: {}, content: ['p1'] },
        { id: 'c2', type: 'callout', data: {} },
        { id: 'p1', type: 'paragraph', data: { text: 'inside' }, parent: 'c2' },
      ],
    });

    expect(model.childrenOf('c1')).toEqual([]);
    expect(model.childrenOf('c2').map((block) => block.id)).toEqual(['p1']);
  });

  it('gives a child claimed by two containers to the first one only', () => {
    const model = buildDocumentModel({
      blocks: [
        { id: 'c1', type: 'callout', data: {}, content: ['p1'] },
        { id: 'c2', type: 'callout', data: {}, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'inside' } },
      ],
    });

    expect(model.childrenOf('c1').map((block) => block.id)).toEqual(['p1']);
    expect(model.childrenOf('c2')).toEqual([]);
  });

  it('ignores a `content[]` entry naming an id the document does not have', () => {
    const model = buildDocumentModel({
      blocks: [
        { id: 'c1', type: 'callout', data: {}, content: ['ghost', 'p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'inside' } },
      ],
    });

    expect(model.childrenOf('c1').map((block) => block.id)).toEqual(['p1']);
    expect(model.byId.has('ghost')).toBe(false);
  });

  it('never lets `content[]` build a cycle', () => {
    const model = buildDocumentModel({
      blocks: [
        { id: 'a', type: 'callout', data: {}, content: ['b'] },
        { id: 'b', type: 'callout', data: {}, content: ['a'] },
      ],
    });

    expect(model.topLevel.map((block) => block.id)).toEqual(['a']);
    expect(model.childrenOf('a').map((block) => block.id)).toEqual(['b']);
    expect(model.childrenOf('b')).toEqual([]);
  });

  it('promotes a block whose `parent` is dangling instead of dropping it', () => {
    const model = buildDocumentModel({
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'orphan' }, parent: 'gone' }],
    });

    expect(model.topLevel.map((block) => block.id)).toEqual(['p1']);
  });

  it('reads the same as the document that also carries the `parent` side', () => {
    const contentOnly = {
      blocks: [
        { id: 'c1', type: 'callout', data: { emoji: '💡' }, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'inside' } },
      ],
    };
    const bothSides = {
      blocks: [
        { id: 'c1', type: 'callout', data: { emoji: '💡' }, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'inside' }, parent: 'c1' },
      ],
    };

    expect(blocksToMarkdown(contentOnly)).toBe('> 💡 inside');
    expect(blocksToMarkdown(contentOnly)).toBe(blocksToMarkdown(bothSides));
  });
});

/**
 * Editor.js-era embed blocks keep the URL at `data.data`. Every Blok reader
 * looks at `url`/`source`, so the block read as an empty link everywhere.
 */
describe('legacy embed URL', () => {
  const legacyEmbed = {
    blocks: [{ id: 'e1', type: 'embed', data: { data: 'https://youtu.be/abc', service: 'youtube' } }],
  };

  it('reaches the markdown exporter', () => {
    expect(blocksToMarkdown(legacyEmbed)).toBe('[youtube](https://youtu.be/abc)');
  });

  it('reaches the plain-text reader', () => {
    expect(blocksToPlainText(legacyEmbed, { includeHiddenText: true })).toContain('https://youtu.be/abc');
  });

  it('leaves an embed that already has a url or source alone', () => {
    const withUrl = {
      blocks: [{ id: 'e1', type: 'embed', data: { data: 'https://legacy.example', url: 'https://current.example' } }],
    };

    expect(blocksToMarkdown(withUrl)).toBe('[https://current.example](https://current.example)');
  });
});
