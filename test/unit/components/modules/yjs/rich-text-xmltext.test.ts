import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

const NUL = String.fromCharCode(0);

/** Mint one block into a real doc and return its integrated data map. */
const mint = (
  serializer: YBlockSerializer,
  block: { id: string; type: string; data: Record<string, unknown> }
): Y.Map<unknown> => {
  const doc = new Y.Doc();
  const yblocks = doc.getArray<Y.Map<unknown>>('blocks');

  yblocks.push([serializer.outputDataToYBlock(block)]);

  return yblocks.get(0).get('data') as Y.Map<unknown>;
};

const storeWith = (block: { id: string; type: string; data: Record<string, unknown> }): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());

  store.fromJSON([block]);

  return store;
};

const textOf = (store: DocumentStore, id: string, key = 'text'): unknown =>
  (store.toJSON().find(block => block.id === id)?.data)?.[key];

const ytextOf = (store: DocumentStore, id: string, key = 'text'): unknown =>
  (store.getBlockById(id)?.get('data') as Y.Map<unknown>).get(key);

describe('rich fields are minted as Y.XmlText', () => {
  it('mints a built-in rich field from HTML as formatted text', () => {
    const data = mint(new YBlockSerializer(), {
      id: 'b1',
      type: 'paragraph',
      data: { text: 'a <b>bold</b> &lt; b' },
    });
    const text = data.get('text');

    expect(text).toBeInstanceOf(Y.XmlText);
    expect((text as Y.XmlText).toDelta()).toEqual([
      { insert: 'a ' },
      { insert: 'bold', attributes: { bold: true } },
      { insert: ' < b' },
    ]);
  });

  it('mints a rich field from segment input, embeds included', () => {
    const data = mint(new YBlockSerializer(), {
      id: 'b1',
      type: 'header',
      data: {
        text: [
          { text: 'x', marks: { link: { href: 'https://a.b', target: undefined } } },
          { embed: { equation: { expression: 'e^x' } } },
        ],
        level: 2,
      },
    });

    expect((data.get('text') as Y.XmlText).toDelta()).toEqual([
      { insert: 'x', attributes: { link: { href: 'https://a.b' } } },
      { insert: { equation: { expression: 'e^x' } } },
    ]);
  });

  it('strips NUL from the minted characters', () => {
    const data = mint(new YBlockSerializer(), { id: 'b1', type: 'paragraph', data: { text: `a${NUL}b` } });

    expect((data.get('text') as Y.XmlText).toDelta()).toEqual([{ insert: 'ab' }]);
  });

  it('mints a tool\'s declared rich field, on top of the built-in table', () => {
    const serializer = new YBlockSerializer({ richTextFieldsFor: type => (type === 'custom' ? ['body'] : []) });

    expect(mint(serializer, { id: 'c', type: 'custom', data: { body: '<i>x</i>' } }).get('body')).toBeInstanceOf(Y.XmlText);
    expect(mint(serializer, { id: 'p', type: 'paragraph', data: { text: 'x' } }).get('text')).toBeInstanceOf(Y.XmlText);
  });

  it('keeps non-rich diffable keys as an unformatted Y.Text holding the raw string', () => {
    const serializer = new YBlockSerializer();
    const code = mint(serializer, { id: 'c', type: 'code', data: { code: '<b>x</b>' } }).get('code');
    const caption = mint(serializer, { id: 'q', type: 'quote', data: { text: 'q', caption: '<b>c</b>' } }).get('caption');
    const custom = mint(serializer, { id: 'u', type: 'custom', data: { text: '<b>t</b>' } }).get('text');

    for (const value of [code, caption, custom]) {
      expect(value).toBeInstanceOf(Y.Text);
      expect(value).not.toBeInstanceOf(Y.XmlText);
    }
    expect((code as Y.Text).toJSON()).toBe('<b>x</b>');
    expect((custom as Y.Text).toJSON()).toBe('<b>t</b>');
  });
});

describe('readers check Y.XmlText first', () => {
  it('reads formatted text back as canonical HTML through its delta', () => {
    const store = storeWith({ id: 'b1', type: 'paragraph', data: { text: 'a <b>bold</b>' } });

    expect(textOf(store, 'b1')).toBe('a <strong>bold</strong>');
  });

  it('keeps markup characters typed as text as text', () => {
    const store = storeWith({ id: 'b1', type: 'paragraph', data: { text: [{ text: 'a < b && "c" <b>' }] } });

    expect(ytextOf(store, 'b1')).toBeInstanceOf(Y.XmlText);
    expect(textOf(store, 'b1')).toBe('a &lt; b &amp;&amp; "c" &lt;b&gt;');
  });

  it('reads an embed rather than dropping it', () => {
    const store = storeWith({
      id: 'b1',
      type: 'paragraph',
      data: { text: [{ text: 'a ' }, { embed: { equation: { expression: 'x' } } }] },
    });

    expect(textOf(store, 'b1')).toContain('data-latex="x"');
  });

  it('still reads an unformatted HTML Y.Text under a rich field (format 1)', () => {
    const root = join(process.cwd(), 'test/unit/server-conformance/fixtures/collab-format1/rich-marks/');
    const update = Uint8Array.from(Buffer.from(readFileSync(`${root}update.b64`, 'utf8').trim(), 'base64'));
    const canonical = JSON.parse(readFileSync(`${root}canonical.json`, 'utf8')) as Array<{ id: string; data: { text: string } }>;
    const store = new DocumentStore(new YBlockSerializer());

    store.applyRemoteUpdate(update);

    for (const block of canonical) {
      expect(ytextOf(store, block.id)).not.toBeInstanceOf(Y.XmlText);
      expect(textOf(store, block.id)).toBe(block.data.text);
    }

    const [first] = canonical;

    store.updateBlockData(first.id, 'text', `${first.data.text}!`);

    expect(ytextOf(store, first.id)).not.toBeInstanceOf(Y.XmlText);
    expect(textOf(store, first.id)).toBe(`${first.data.text}!`);
  });
});

describe('DocumentStore writes to a rich field', () => {
  it('mints Y.XmlText when a rich key appears on a block that lacked it', () => {
    const store = storeWith({ id: 'b1', type: 'header', data: { level: 2 } });

    store.updateBlockData('b1', 'text', '<em>late</em>');

    expect(ytextOf(store, 'b1')).toBeInstanceOf(Y.XmlText);
    expect(textOf(store, 'b1')).toBe('<i>late</i>');
  });

  it('writes nothing when a save only respells the HTML', () => {
    const store = storeWith({ id: 'b1', type: 'paragraph', data: { text: 'a <strong>b</strong>&nbsp;c' } });

    expect(store.updateBlockData('b1', 'text', 'a <b>b</b> c<br>')).toBe(false);
  });

  it('updates the formatted text in place, never an HTML string', () => {
    const store = storeWith({ id: 'b1', type: 'paragraph', data: { text: 'a <a href="https://x.y">link</a>' } });
    const before = ytextOf(store, 'b1');

    expect(store.updateBlockData('b1', 'text', 'a <a href="https://x.y">link</a> now <b>b</b>')).toBe(true);

    expect(ytextOf(store, 'b1')).toBe(before);
    expect((before as Y.XmlText).toDelta()).toEqual([
      { insert: 'a ' },
      { insert: 'link', attributes: { link: { href: 'https://x.y' } } },
      { insert: ' now ' },
      { insert: 'b', attributes: { bold: true } },
    ]);
  });

  it('un-bolding a word changes marks only, no characters', () => {
    const store = storeWith({ id: 'b1', type: 'paragraph', data: { text: 'one <b>two</b> three' } });
    const text = ytextOf(store, 'b1') as Y.XmlText;
    const ops: Array<{ insert?: unknown; delete?: number }> = [];

    text.observe(event => ops.push(...event.delta));
    store.updateBlockData('b1', 'text', 'one two three');

    expect(ops.length).toBeGreaterThan(0);
    expect(ops.filter(op => op.insert !== undefined || op.delete !== undefined)).toEqual([]);
    expect(textOf(store, 'b1')).toBe('one two three');
  });

  it('keeps both peers\' words when they type into one bold run', () => {
    const a = storeWith({ id: 'b1', type: 'paragraph', data: { text: 'hello <b>world</b>' } });
    const b = new DocumentStore(new YBlockSerializer());

    b.applyRemoteUpdate(a.encodeStateAsUpdate());
    a.updateBlockData('b1', 'text', 'hello <b>woXrld</b>');
    b.updateBlockData('b1', 'text', 'hello <b>worlYd</b>');
    b.applyRemoteUpdate(a.encodeStateAsUpdate(b.getStateVector()));
    a.applyRemoteUpdate(b.encodeStateAsUpdate(a.getStateVector()));

    expect(textOf(a, 'b1')).toBe('hello <strong>woXrlYd</strong>');
    expect(textOf(b, 'b1')).toBe(textOf(a, 'b1'));
  });
});
