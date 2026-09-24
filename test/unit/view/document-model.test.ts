// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { blocksToHtml, blocksToMarkdown, blocksToPlainText, outlineFromOutputData } from '../../../src/view';
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

/**
 * Child order follows the parent's `content` (Notion rule), then children it
 * does not list in array order — the same rule the editor applies on load.
 */
describe('child order follows the parent `content`', () => {
  const doc = {
    blocks: [
      { id: 'r1', type: 'paragraph', data: { text: 'root one' } },
      { id: 't', type: 'toggle', data: { text: 'Parent' }, content: ['c2', 'c2', 'c1', 'x', 'other'] },
      { id: 'c1', type: 'header', data: { text: 'First in array', level: 2 }, parent: 't' },
      { id: 'c3', type: 'header', data: { text: 'Unlisted', level: 2 }, parent: 't' },
      { id: 'c2', type: 'header', data: { text: 'First in content', level: 2 }, parent: 't' },
      { id: 'r2', type: 'callout', data: {} },
      { id: 'other', type: 'paragraph', data: { text: 'belongs elsewhere' }, parent: 'r2' },
    ],
  };

  it('orders a parent children by `content`, then unlisted ones, once each', () => {
    const model = buildDocumentModel(doc);

    expect(model.childrenOf('t').map((block) => block.id)).toEqual(['c2', 'c1', 'c3']);
    expect(model.childrenOf('r2').map((block) => block.id)).toEqual(['other']);
    expect(model.topLevel.map((block) => block.id)).toEqual(['r1', 't', 'r2']);
  });

  it('renders HTML in that order', () => {
    const html = blocksToHtml(doc);

    expect(html.indexOf('First in content')).toBeLessThan(html.indexOf('First in array'));
    expect(html.indexOf('First in array')).toBeLessThan(html.indexOf('Unlisted'));
  });

  it('renders plain text in that order', () => {
    const text = blocksToPlainText(doc);

    expect(text.indexOf('First in content')).toBeLessThan(text.indexOf('First in array'));
    expect(text.indexOf('First in array')).toBeLessThan(text.indexOf('Unlisted'));
  });

  it('renders Markdown in that order', () => {
    const markdown = blocksToMarkdown(doc);

    expect(markdown.indexOf('First in content')).toBeLessThan(markdown.indexOf('First in array'));
    expect(markdown.indexOf('First in array')).toBeLessThan(markdown.indexOf('Unlisted'));
  });

  it('lists outline headings in that order', () => {
    expect(outlineFromOutputData(doc).map((entry) => entry.id)).toEqual(['c2', 'c1', 'c3']);
  });
});
