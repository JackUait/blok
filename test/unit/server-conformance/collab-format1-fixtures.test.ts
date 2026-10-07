// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

/**
 * Guards the frozen format-1 rooms in `fixtures/collab-format1/` (inputs for
 * the C3 migration tests). Uses raw yjs only: the client serializer changes
 * format in Plan B, and these bytes must keep meaning what they meant.
 */
const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/collab-format1', import.meta.url));

/** Format 1's rich fields, hard-coded: this table must not follow later changes. */
const FORMAT1_RICH_TYPES = new Set(['paragraph', 'header', 'quote', 'toggle', 'list']);

interface CanonicalBlock {
  data?: Record<string, unknown>;
  id: string;
  type: string;
}

interface RichText {
  blockId: string;
  html: string;
  ytext: unknown;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const caseNames = (): string[] => {
  const manifest = readJson(join(FIXTURE_ROOT, 'manifest.json')) as { cases: Array<{ name: string }> };

  return manifest.cases.map(entry => entry.name);
};

const loadDoc = (name: string): Y.Doc => {
  const doc = new Y.Doc();
  const base64 = readFileSync(join(FIXTURE_ROOT, name, 'update.b64'), 'utf8').replace(/\s/g, '');

  Y.applyUpdate(doc, new Uint8Array(Buffer.from(base64, 'base64')));

  return doc;
};

const richTexts = (name: string): RichText[] => {
  const blocks = loadDoc(name).getMap<Y.Map<unknown>>('blocks');
  const canonical = readJson(join(FIXTURE_ROOT, name, 'canonical.json')) as CanonicalBlock[];
  const out: RichText[] = [];

  blocks.forEach((block, key) => {
    const type = block.get('type');
    const data = block.get('data');

    if (typeof type !== 'string' || !FORMAT1_RICH_TYPES.has(type) || !(data instanceof Y.Map) || !data.has('text')) {
      return;
    }

    const html = canonical.find(entry => entry.id === key)?.data?.text;

    out.push({ blockId: key, html: typeof html === 'string' ? html : '', ytext: data.get('text') });
  });

  return out;
};

describe('frozen format-1 collab fixtures', () => {
  it('lists exactly the case directories in its manifest', () => {
    const directories = readdirSync(FIXTURE_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

    expect(directories).toStrictEqual([...caseNames()].sort());
  });

  it.each(caseNames())('%s: every rich field is an unformatted Y.Text holding the HTML string', (name) => {
    for (const { blockId, html, ytext } of richTexts(name)) {
      expect(ytext, blockId).toBeInstanceOf(Y.Text);
      expect(ytext, blockId).not.toBeInstanceOf(Y.XmlText);

      const text = ytext as Y.Text;
      const delta = text.toDelta() as Array<{ attributes?: unknown; insert: unknown }>;

      expect(delta.length, blockId).toBeLessThanOrEqual(1);
      expect(delta.every(op => typeof op.insert === 'string' && op.attributes === undefined), blockId).toBe(true);
      expect(text.toJSON(), blockId).toBe(html);
    }
  });

  it('keeps a corpus that covers every kind of inline markup', () => {
    const html = caseNames().flatMap(name => richTexts(name).map(entry => entry.html)).join('\n');

    for (const needle of ['<a href=', 'target=', 'rel=', 'data-latex=', 'data-blok-page-id=', '<mark', 'background-color', '<strong>', '<em>', '<b>', '<i>', '<u>', '<s>', '<code>', '<sup>', '<sub>', '<br>', '&lt;', '&amp;', '<abbr']) {
      expect(html, needle).toContain(needle);
    }
    for (const type of FORMAT1_RICH_TYPES) {
      expect(caseNames().some(name => richTexts(name).length > 0 && (readJson(join(FIXTURE_ROOT, name, 'canonical.json')) as CanonicalBlock[]).some(block => block.type === type && typeof block.data?.text === 'string' && block.data.text.includes('<'))), type).toBe(true);
    }
  });

  it('keeps the fields C3 must not convert as unformatted HTML', () => {
    const data = (id: string): Y.Map<unknown> => {
      const block = loadDoc('rich-negatives').getMap<Y.Map<unknown>>('blocks').get(id);
      const value = block?.get('data');

      if (!(value instanceof Y.Map)) {
        throw new Error(`rich-negatives: ${id} has no data map`);
      }

      return value as Y.Map<unknown>;
    };
    const plainText = [
      ['n-code', 'code', '<b>not markup</b> &amp; a < b'],
      ['n-image', 'caption', 'a <b>bold</b> caption'],
      ['n-callout', 'title', '<b>legacy</b> title'],
      ['n-widget', 'text', '<b>custom</b> tool text'],
    ] as const;

    for (const [id, key, html] of plainText) {
      const value = data(id).get(key);

      expect(value, id).toBeInstanceOf(Y.Text);
      expect(value, id).not.toBeInstanceOf(Y.XmlText);
      expect((value as Y.Text).toDelta(), id).toStrictEqual([{ insert: html }]);
    }

    const properties = data('n-row').get('properties');
    const nested: unknown[] = [];

    expect(properties).toBeInstanceOf(Y.Map);
    // The nested row document is plain JSON in Yjs: no text type anywhere under it.
    const walk = (value: unknown): void => {
      nested.push(value);
      if (value instanceof Y.Map || value instanceof Y.Array) {
        value.forEach((child: unknown) => walk(child));
      }
    };

    walk(properties);
    expect(nested.some(value => value instanceof Y.Text)).toBe(false);
    expect(JSON.stringify((properties as Y.Map<unknown>).toJSON())).toContain('"text":"<b>nested</b> doc"');
  });
});
