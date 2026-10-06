// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { blocksToHtml, blocksToMarkdown, blocksToPlainText, extractTexts, injectTexts, outlineFromOutputData, pageIndex } from '../../../src/view';
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

/**
 * The editor never keeps a non-`tab` child under `tabs`: the tabs tool evicts
 * each one to the tabs block's own parent, right after the tabs block, subtree
 * and order kept. The static renderers must read the same document. Expected
 * orders match the editor's save order, pinned in
 * test/unit/tools/tabs/tabs-stray-eviction.integration.test.ts.
 */
describe('stray children of `tabs` move out the way the editor evicts them', () => {
  /** Pre-order ids, the order the editor's save() lists them. */
  const readingOrder = (input: Parameters<typeof buildDocumentModel>[0]): string[] => {
    const model = buildDocumentModel(input);
    const ids: string[] = [];
    const visit = (block: { id?: string }): void => {
      ids.push(block.id ?? '?');
      model.childrenOf(block.id).forEach(visit);
    };

    model.topLevel.forEach(visit);

    return ids;
  };

  const probe = {
    blocks: [
      { id: 'before', type: 'paragraph', data: { text: 'BEFORE' } },
      { id: 'tabs', type: 'tabs', data: {}, content: ['s1', 't1', 's2'] },
      { id: 's1', type: 'paragraph', data: { text: 'S1' }, parent: 'tabs', content: ['s1c'] },
      { id: 's1c', type: 'paragraph', data: { text: 'S1C' }, parent: 's1' },
      { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      { id: 's2', type: 'paragraph', data: { text: 'S2' }, parent: 'tabs' },
      { id: 'after', type: 'paragraph', data: { text: 'AFTER' } },
    ],
  };

  it('places root-level strays right after the tabs subtree, subtree kept', () => {
    const model = buildDocumentModel(probe);

    expect(readingOrder(probe)).toEqual(['before', 'tabs', 't1', 'p1', 's1', 's1c', 's2', 'after']);
    expect(model.childrenOf('tabs').map((block) => block.id)).toEqual(['t1']);
    expect(model.topLevel.map((block) => block.id)).toEqual(['before', 'tabs', 's1', 's2', 'after']);
  });

  it('keeps a tabs block that holds only a stray, empty, with the stray after it', () => {
    const doc = {
      blocks: [
        { id: 'tabs', type: 'tabs', data: {}, content: ['s1'] },
        { id: 's1', type: 'paragraph', data: { text: 'S1' }, parent: 'tabs' },
        { id: 'after', type: 'paragraph', data: { text: 'AFTER' } },
      ],
    };

    expect(readingOrder(doc)).toEqual(['tabs', 's1', 'after']);
    expect(buildDocumentModel(doc).childrenOf('tabs')).toEqual([]);
  });

  it('keeps a stray in the container that holds the tabs, right after the tabs', () => {
    const doc = {
      blocks: [
        { id: 'before', type: 'paragraph', data: { text: 'B' } },
        { id: 'o', type: 'toggle', data: { text: 'O' }, content: ['c', 'o2'] },
        { id: 'c', type: 'toggle', data: { text: 'C' }, parent: 'o', content: ['tabs', 'i2'] },
        { id: 'tabs', type: 'tabs', data: {}, parent: 'c', content: ['s1', 't1'] },
        { id: 's1', type: 'paragraph', data: { text: 'S1' }, parent: 'tabs', content: ['s1c'] },
        { id: 's1c', type: 'paragraph', data: { text: 'S1C' }, parent: 's1' },
        { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs' },
        { id: 'i2', type: 'paragraph', data: { text: 'I2' }, parent: 'c' },
        { id: 'o2', type: 'paragraph', data: { text: 'O2' }, parent: 'o' },
        { id: 'after', type: 'paragraph', data: { text: 'A' } },
      ],
    };

    expect(readingOrder(doc)).toEqual(['before', 'o', 'c', 'tabs', 't1', 's1', 's1c', 'i2', 'o2', 'after']);
    expect(buildDocumentModel(doc).childrenOf('c').map((block) => block.id)).toEqual(['tabs', 's1', 'i2']);
  });

  it('puts each tabs block\'s strays right after it when two share a container', () => {
    const doc = {
      blocks: [
        { id: 'c', type: 'toggle', data: { text: 'C' }, content: ['ta', 'tb'] },
        { id: 'ta', type: 'tabs', data: {}, parent: 'c', content: ['a1', 'ta1', 'a2'] },
        { id: 'a1', type: 'paragraph', data: { text: 'A1' }, parent: 'ta' },
        { id: 'ta1', type: 'tab', data: { title: 'x' }, parent: 'ta' },
        { id: 'a2', type: 'paragraph', data: { text: 'A2' }, parent: 'ta' },
        { id: 'tb', type: 'tabs', data: {}, parent: 'c', content: ['b1', 'tb1'] },
        { id: 'b1', type: 'paragraph', data: { text: 'B1' }, parent: 'tb' },
        { id: 'tb1', type: 'tab', data: { title: 'y' }, parent: 'tb' },
        { id: 'after', type: 'paragraph', data: { text: 'A' } },
      ],
    };

    expect(readingOrder(doc)).toEqual(['c', 'ta', 'ta1', 'a1', 'a2', 'tb', 'tb1', 'b1', 'after']);
  });

  it('leaves a lone root-level tab where it is', () => {
    const doc = {
      blocks: [
        { id: 't1', type: 'tab', data: { title: 'Do' }, content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      ],
    };

    expect(readingOrder(doc)).toEqual(['t1', 'p1']);
  });

  it('keeps extractTexts and injectTexts aligned on a document with strays', () => {
    const texts = extractTexts(probe);
    const translated = injectTexts(probe, texts.map((text) => `~${text}`));

    expect(extractTexts(translated)).toEqual(texts.map((text) => `~${text}`));
  });

  it('lists outline headings in editor order', () => {
    const doc = {
      blocks: [
        { id: 'tabs', type: 'tabs', data: {}, content: ['h1', 't1'] },
        { id: 'h1', type: 'header', data: { text: 'Stray', level: 2 }, parent: 'tabs' },
        { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs', content: ['h2'] },
        { id: 'h2', type: 'header', data: { text: 'Inside', level: 2 }, parent: 't1' },
      ],
    };

    expect(outlineFromOutputData(doc).map((entry) => entry.id)).toEqual(['h2', 'h1']);
  });

  it('lists page-index text in editor order', () => {
    expect(pageIndex(probe).text.map((entry) => entry.blockId))
      .toEqual(['before', 'tabs', 't1', 'p1', 's1', 's1c', 's2', 'after']);
  });
});
