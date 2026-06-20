import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';

/**
 * Editor.js -> Blok migration verification for editor.js block types Blok has
 * NO same-named native tool for: `raw` (@editorjs/raw), `warning`
 * (@editorjs/warning), and `attaches` (@editorjs/attaches).
 *
 * These previously passed through with their original type and rendered as a
 * Stub. They are now mapped to the closest faithful Blok tool:
 *
 *   raw      -> code     ({ html } becomes { code: html } — source shown verbatim)
 *   warning  -> callout  (⚠️ emoji + orange background, title/message as child
 *                         paragraph blocks via content[])
 *   attaches -> bookmark ({ file: { url }, title } -> { url, title }; file
 *                         metadata size/extension/name dropped + warned)
 *
 * These tests run the EXACT runtime migration pipeline (the same calls made on
 * data load with dataModel 'auto'). Nothing is mocked except silencing
 * console.warn. The transform functions are the real ones.
 */

const RENDERABLE_TYPES = new Set([
  'paragraph',
  'header',
  'list',
  'table',
  'toggle',
  'callout',
  'database',
  'database-row',
  'divider',
  'quote',
  'code',
  'image',
  'column_list',
  'column',
  'embed',
  'bookmark',
  'delimiter',
]);

const runMigration = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const analysis = analyzeDataFormat(blocks);

  return shouldExpandToHierarchical('auto', analysis.format)
    ? expandToHierarchical(blocks)
    : blocks;
};

describe('editorjs map: previously-unsupported blocks (raw / warning / attaches)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps raw -> code, preserving the html as code text', () => {
    const out = runMigration([
      { id: 'raw-1', type: 'raw', data: { html: '<div class="legacy">hi</div>' } },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('code');
    expect((out[0].data as { code: string }).code).toBe('<div class="legacy">hi</div>');
    expect(RENDERABLE_TYPES.has(out[0].type)).toBe(true);
    expect(out[0].id).toBe('raw-1');
  });

  it('maps an empty raw block -> code with empty string', () => {
    const out = runMigration([{ id: 'raw-empty', type: 'raw', data: { html: '' } }]);

    expect(out[0].type).toBe('code');
    expect((out[0].data as { code: string }).code).toBe('');
  });

  it('maps warning -> callout (⚠️ + orange bg) with title/message child paragraphs', () => {
    const out = runMigration([
      { id: 'warn-1', type: 'warning', data: { title: 'Note', message: 'This is important' } },
    ]);

    const callout = out.find(b => b.type === 'callout');

    expect(callout).toBeDefined();
    expect(callout?.id).toBe('warn-1');
    expect(RENDERABLE_TYPES.has(callout?.type ?? '')).toBe(true);

    const data = callout?.data as Record<string, unknown>;

    expect(data.emoji).toBe('⚠️');
    expect(data.backgroundColor).toBe('orange');

    const children = out.filter(b => b.type === 'paragraph' && b.parent === 'warn-1');

    expect(children.map(b => (b.data as { text: string }).text)).toEqual(['Note', 'This is important']);
    // The callout references its children in document order.
    expect(callout?.content).toEqual(children.map(b => b.id));
  });

  it('maps a warning with only a message -> callout with a single child paragraph', () => {
    const out = runMigration([
      { id: 'warn-2', type: 'warning', data: { title: '', message: 'Just a message' } },
    ]);

    const callout = out.find(b => b.type === 'callout');
    const children = out.filter(b => b.type === 'paragraph' && b.parent === 'warn-2');

    expect(children).toHaveLength(1);
    expect((children[0].data as { text: string }).text).toBe('Just a message');
    expect(callout?.content).toEqual([children[0].id]);
  });

  it('maps attaches -> bookmark with url + title; file metadata dropped', () => {
    const out = runMigration([
      {
        id: 'att-1',
        type: 'attaches',
        data: {
          file: {
            url: 'https://example.com/report.pdf',
            name: 'report',
            size: 102400,
            extension: 'pdf',
          },
          title: 'Quarterly report',
        },
      },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('bookmark');
    expect(RENDERABLE_TYPES.has(out[0].type)).toBe(true);

    const data = out[0].data;

    expect(data.url).toBe('https://example.com/report.pdf');
    expect(data.title).toBe('Quarterly report');
    // File metadata has no bookmark equivalent and must be dropped.
    expect(data.size).toBeUndefined();
    expect(data.extension).toBeUndefined();
    expect(data.file).toBeUndefined();
  });

  it('mixed document: raw/warning/attaches all become renderable Blok blocks', () => {
    const out = runMigration([
      { id: 'p-1', type: 'paragraph', data: { text: 'before' } },
      { id: 'raw-2', type: 'raw', data: { html: '<b>x</b>' } },
      { id: 'warn-3', type: 'warning', data: { title: 't', message: 'm' } },
      {
        id: 'att-2',
        type: 'attaches',
        data: { file: { url: 'u', name: 'n', size: 1, extension: 'zip' }, title: 'z' },
      },
      { id: 'p-2', type: 'paragraph', data: { text: 'after' } },
    ]);

    const byId = new Map(out.map(b => [b.id, b]));

    expect(byId.get('raw-2')?.type).toBe('code');
    expect(byId.get('warn-3')?.type).toBe('callout');
    expect(byId.get('att-2')?.type).toBe('bookmark');

    // Every emitted block is renderable and carries a non-empty id.
    for (const block of out) {
      expect(RENDERABLE_TYPES.has(block.type)).toBe(true);
      expect(block.id).toBeTruthy();
    }
  });

  it('assigns an id to an id-less raw block (raw alone now triggers expansion)', () => {
    const out = runMigration([
      { type: 'raw', data: { html: '<p>no id</p>' } } as OutputBlockData,
    ]);

    expect(analyzeDataFormat([{ type: 'raw', data: { html: '<p>no id</p>' } } as OutputBlockData]).format).toBe('legacy');
    expect(out[0].type).toBe('code');
    expect(out[0].id).toBeTruthy();
  });
});
