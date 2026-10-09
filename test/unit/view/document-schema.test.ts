/**
 * Drift guard for the published document schema.
 *
 * `blokDocumentSchema` is hand-authored, so CLAUDE.md's "hand-transcription
 * drifts — generate instead" law applies: this test has to be strong enough to
 * substitute for generation. A name-only check would not notice a renamed
 * `data` field, so every per-type sample here comes from the tool's REAL
 * `save()` (seeded maximally, so every optional field is actually emitted) and
 * the key sets are compared in BOTH directions — a field renamed in the tool
 * and a field left stale in the schema each go red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import {
  Audio,
  Bookmark,
  Callout,
  Code,
  Column,
  ColumnList,
  Database,
  DatabaseRow,
  Divider,
  Embed,
  File as FileTool,
  Header,
  Image as ImageTool,
  List,
  Page,
  PageLink,
  Paragraph,
  Quote,
  Spacer,
  Table,
  TableOfContents,
  TabTool,
  TabsTool,
  Toggle,
  Video,
  defaultBlockTools,
} from '../../../src/tools';
import { validateAgainst } from '../../../src/shared/schema/validate';
import * as pageDescriptions from '../../../src/shared/tool-descriptions/page';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../src/shared/tool-descriptions';
import { blokDocumentSchema } from '../../../src/view/document-schema';
import { createMemoryViewState } from '../../helpers/view-state';

import type { API, BlockToolConstructorOptions, OutputData } from '../../../types';
import type { Title } from '../../../types/api/title';
import type { ImageMarkup } from '../../../types/tools/image';

type JsonSchema = {
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  $defs?: Record<string, JsonSchema>;
};

/**
 * Every block tool Blok ships a saved shape for. `page` is built in but not a
 * default: without the host's `href`/`resolve` config it is a dead link, so it
 * is registered by hand. Export names cannot stand in for this list — they are
 * class names (`Columns`), not the registry keys a saved block's `type` holds.
 */
const BUILT_IN_BLOCK_TOOLS: readonly string[] = [...Object.keys(defaultBlockTools), 'page', 'page-link'];

const schema = blokDocumentSchema as unknown as JsonSchema;
const defs = schema.$defs ?? {};
const blockSchema = (schema.properties?.blocks ?? {}) as JsonSchema;

/* ------------------------------------------------------------------ */
/* Tool harness — enough of the editor surface for render() + save()   */
/* ------------------------------------------------------------------ */

const api = {
  styles: {},
  i18n: { t: (key: string) => key },
  viewState: createMemoryViewState(),
  events: { on: () => {}, off: () => {}, emit: () => {} },
  blocks: {
    getById: () => null,
    getBlockIndex: () => 0,
    getBlocksCount: () => 1,
    getBlockByIndex: () => undefined,
    getCurrentBlockIndex: () => 0,
  },
} as unknown as API;

const block = {
  id: 'sample',
  name: 'sample',
  on: () => {},
  off: () => {},
  emit: () => {},
  dispatchChange: () => {},
  parentId: null,
  contentIds: [],
} as never;

const options = <D extends Record<string, unknown>, C extends Record<string, unknown>>(data: D, config?: C): BlockToolConstructorOptions<D, C> => ({
  data,
  config: (config ?? {}) as C,
  api,
  readOnly: false,
  block,
});

const contentElement = (html: string): HTMLDivElement => {
  const element = document.createElement('div');

  element.innerHTML = html;

  return element;
};

/**
 * One saved `data` payload per built-in tool, produced by the tool's own
 * `save()`.
 *
 * Every seed is MAXIMAL on purpose — each optional field is set to a value the
 * tool will not drop (colors truthy, `list.start !== 1`, `list.depth > 0`,
 * `column.widthRatio !== 1`, `image.crop` not a full rect, the boolean media
 * flags true). The bidirectional assertion below is only as strong as this
 * seed: a field that never reaches `save()` cannot be compared.
 */
const savedData: Record<string, Record<string, unknown>> = {
  paragraph: new Paragraph(
    options({ text: 'Hi', textColor: 'red', backgroundColor: 'blue' })
  ).save(contentElement('Hi <b>there</b>')),

  header: ((): Record<string, unknown> => {
    const tool = new Header(options({
      text: 'Title', level: 2, isToggleable: true,
      textColor: 'red', backgroundColor: 'blue', anchor: 'title',
    }));

    tool.render();

    return tool.save(contentElement('Title'));
  })(),

  list: ((): Record<string, unknown> => {
    const tool = new List(options({ text: 'Item', style: 'checklist', checked: true, start: 3, depth: 2 }));

    tool.render();

    return tool.save();
  })(),

  table: new Table(options({
    withHeadings: true,
    withHeadingColumn: false,
    stretched: true,
    content: [[{ blocks: [] }]],
    colWidths: [100],
    initialColWidth: 100,
    textSize: 'comfortable',
  })).save(contentElement('')),

  toggle: ((): Record<string, unknown> => {
    const tool = new Toggle(options({ text: 'Summary' }));

    tool.render();

    return tool.save();
  })(),

  callout: new Callout(options({ emoji: '💡', textColor: 'red', backgroundColor: 'blue' })).save(),

  database: new Database(options({
    title: 'Tasks',
    schema: [{ id: 'p1', name: 'Name', type: 'title', position: 'a0' }],
    views: [{
      id: 'v1', name: 'All', type: 'table', position: 'a0',
      sorts: [], filters: [], visibleProperties: ['p1'],
    }],
    activeViewId: 'v1',
  })).save(contentElement('')),

  // A row as the tool writes one today: a top-level `title` beside the
  // properties mirror. A row saved before that key existed still omits it.
  'database-row': new DatabaseRow(options({ properties: { p1: 'Ship it' }, position: 'a0', title: 'Ship it', pageId: 'row-page', convertedValues: { p2: { type: 'text', value: '007' } }, bodyBlocks: true }))
    .save(contentElement('')),

  page: new Page(options({ pageId: 'p1', textColor: 'red', backgroundColor: 'blue', cache: { title: 'Roadmap', icon: { type: 'emoji', value: '🗺' } } })).save(),
  'page-link': new PageLink(options({ pageId: 'p1' })).save(),

  divider: new Divider(options({})).save(),

  spacer: new Spacer(options({ height: 40 })).save(),

  table_of_contents: new TableOfContents(options({ textColor: 'red', backgroundColor: 'blue' })).save(),

  quote: new Quote(options({ text: 'Wise words', size: 'large' })).save(
    contentElement('Wise words') as unknown as HTMLQuoteElement
  ),

  code: new Code(options({ code: 'x = 1', language: 'python', lineNumbers: true, filename: 'main.py' })).save(contentElement('')),

  image: new ImageTool(options({
    url: 'https://example.com/a.png', caption: 'Cap', width: 50, alignment: 'left',
    alt: 'Alt', fileName: 'a.png', size: 'md', frame: 'border', rounded: true,
    captionVisible: true, naturalWidth: 800, naturalHeight: 600,
    crop: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' },
    rotation: 90, flipX: true, straighten: 5, filter: 'warm', filterStrength: 60,
    adjust: { brightness: 10, contrast: 20, saturation: 30 },
    variants: [{ url: 'https://example.com/a.avif', mimeType: 'image/avif' }, { url: 'https://example.com/a.png', mimeType: 'image/png' }],
    markup: [
      { id: 'm1', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.8], size: 0.012 },
      { id: 'm2', type: 'rect', color: '#0a84ff', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, size: 0.012, fill: true },
      { id: 'm3', type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.06, style: 'outline', rotation: 15 },
      { id: 'm4', type: 'rounded-rect', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
      { id: 'm5', type: 'bubble', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012, tx: 0.15, ty: 0.8 },
      { id: 'm6', type: 'star', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012, rotation: 30 },
      { id: 'm7', type: 'polygon', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
      { id: 'm8', type: 'spotlight', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
      { id: 'm9', type: 'magnifier', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
      { id: 'm10', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.8], size: 0.012, cut: 'both' },
      { id: 'm11', type: 'ellipse', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
      { id: 'm12', type: 'line', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
      { id: 'm13', type: 'arrow', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
      { id: 'm14', type: 'highlighter', color: '#ffcc00', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.8], size: 0.036 },
    ],
  })).save(),

  file: new FileTool(options({
    url: 'https://example.com/a.pdf', fileName: 'a.pdf', size: 1024,
    mimeType: 'application/pdf', caption: 'Cap', captionVisible: true,
  })).save(),

  audio: new Audio(options({
    url: 'https://example.com/a.mp3', caption: 'Cap', captionVisible: true,
    title: 'Song', artist: 'Someone', coverUrl: 'https://example.com/c.png',
    loop: true, width: 50, alignment: 'left', fileName: 'a.mp3',
    mimeType: 'audio/mpeg', duration: 120, peaks: [0.1, 0.9],
  })).save(),

  video: new Video(options({
    url: 'https://example.com/a.mp4', caption: 'Cap', captionVisible: true,
    width: 50, alignment: 'left', autoplay: true, loop: true, hideControls: true,
    fileName: 'a.mp4', mimeType: 'video/mp4', aspectRatio: '16 / 9',
    variants: [{ url: 'https://example.com/a.webm', mimeType: 'video/webm' }, { url: 'https://example.com/a.mp4', mimeType: 'video/mp4' }],
  })).save(),

  column_list: new ColumnList(options({})).save(),

  column: new Column(options({ widthRatio: 2 })).save(),

  tabs: new TabsTool(options({})).save(),

  // TabData is an interface, so spread it into a plain record.
  tab: { ...new TabTool(options({ title: 'Overview', icon: '📋' })).save() },

  embed: new Embed(options({
    service: 'youtube', source: 'https://youtu.be/x', embed: 'https://www.youtube.com/embed/x',
    kind: 'iframe', width: 580, height: 320, widthPercent: 50, alignment: 'left',
    caption: 'Cap', captionVisible: true,
  })).save(),

  bookmark: new Bookmark(options(
    {
      url: 'https://example.com', title: 'Title', description: 'Desc',
      image: 'https://example.com/og.png', favicon: 'https://example.com/f.ico',
      domain: 'example.com',
    },
    { endpoint: 'https://example.com/unfurl' }
  )).save(),
};

describe('blokDocumentSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a draft 2020-12 schema for the saved document envelope', () => {
    expect(blokDocumentSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['blocks', 'icon', 'id', 'time', 'title', 'version']);
  });

  describe('published bytes', () => {
    // Any diff here is a published change. Re-pin only on purpose.
    it('serializes exactly as the pinned snapshot', async () => {
      await expect(JSON.stringify(blokDocumentSchema, null, 2))
        .toMatchFileSnapshot('./__snapshots__/document-schema.json');
    });
  });

  describe('shared page icon schema', () => {
    it('exports the same icon schema used by the document root', () => {
      const sharedIconSchema: unknown = 'PAGE_ICON_SCHEMA' in pageDescriptions
        ? pageDescriptions.PAGE_ICON_SCHEMA
        : undefined;

      expect(sharedIconSchema).toBe(blokDocumentSchema.properties.icon);
    });

    it('keeps page fields optional and rejects an empty title', () => {
      expect(validateAgainst(blokDocumentSchema, { blocks: [], title: '' })
        .map(problem => problem.path)).toEqual(['/title']);
      expect(validateAgainst(blokDocumentSchema, { blocks: [] })).toEqual([]);
    });

    it.each([
      {
        branch: 'emoji',
        icon: { type: 'emoji', value: '🗺', extension: 'kept' },
      },
      {
        branch: 'image',
        icon: { type: 'image', url: 'https://example.com/icon.png', extension: 'kept' },
      },
    ])('$branch: accepts icon extra keys preserved by the page map', ({ icon }) => {
      expect(validateAgainst(blokDocumentSchema, { blocks: [], icon })).toEqual([]);
    });

    it.each([
      { branch: 'emoji', icon: { type: 'emoji' } },
      { branch: 'image', icon: { type: 'image' } },
    ])('$branch: rejects an icon without its required payload', ({ icon }) => {
      expect(validateAgainst(blokDocumentSchema, { blocks: [], icon })
        .map(problem => problem.path)).toEqual(['/icon']);
    });

    it('rejects a nested page object instead of changing the flat envelope', () => {
      expect(validateAgainst(blokDocumentSchema, { blocks: [], page: { title: 'Plan' } })
        .map(problem => problem.path)).toEqual(['/page']);
    });
  });

  describe('coverage', () => {
    /**
     * The comparison is bidirectional: a new tool without a def AND a def left
     * behind by a removed tool both fail.
     */
    it('has exactly one $defs entry per built-in block tool', () => {
      expect(Object.keys(defs).sort()).toEqual([...BUILT_IN_BLOCK_TOOLS].sort());
    });

    it('routes every built-in type to its own def', () => {
      const branches = (blockSchema.items as unknown as { allOf?: Array<{
        if: { properties: { type: { const: string } } };
        then: { properties: { data: { $ref: string } } };
      }> }).allOf ?? [];
      const routed = Object.fromEntries(
        branches.map(branch => [branch.if.properties.type.const, branch.then.properties.data.$ref])
      );

      BUILT_IN_BLOCK_TOOLS.forEach((name) => {
        expect(routed[name]).toBe(`#/$defs/${name}`);
      });
    });
  });

  describe('database-row', () => {
    it('declares a nonempty optional page pointer saved beside row data', () => {
      const row = defs['database-row'];

      expect(savedData['database-row']).toHaveProperty('pageId', 'row-page');
      expect(row.properties?.pageId).toMatchObject({ type: 'string', minLength: 1 });
      expect(row.required).not.toContain('pageId');
      expect(row.additionalProperties).toBe(false);
    });
  });

  describe('page', () => {
    it('describes the saved pointer id and block color, not legacy cached metadata', () => {
      const page = defs.page;

      expect(savedData.page).toEqual({ pageId: 'p1', textColor: 'red', backgroundColor: 'blue' });
      expect(page.required).toEqual(['pageId']);
      expect(page.additionalProperties).toBe(false);
      expect(Object.keys(page.properties ?? {})).toEqual(['pageId', 'textColor', 'backgroundColor']);
      expect(page.description).toMatch(/separate document/);
    });

    it('routes the page type to its def', () => {
      const branches = (blockSchema.items as unknown as { allOf?: Array<{
        if: { properties: { type: { const: string } } };
        then: { properties: { data: { $ref: string } } };
      }> }).allOf ?? [];

      expect(branches.some(branch =>
        branch.if.properties.type.const === 'page' && branch.then.properties.data.$ref === '#/$defs/page'
      )).toBe(true);
    });
  });

  describe('documents saved by older versions', () => {
    /**
     * v1.15.2 saved `isOpen` on toggles and toggle headings. The editor ignores it
     * now, but the closed defs must still accept those documents.
     */
    it.each([
      ['toggle', { text: 'Summary', isOpen: true }],
      ['header', { text: 'Title', level: 2, isToggleable: true, isOpen: false }],
    ])('%s: accepts a v1.15.2 payload with isOpen', (name, data) => {
      const def = defs[name];
      const declared = Object.keys(def.properties ?? {});

      expect(def.additionalProperties).toBe(false);
      Object.keys(data).forEach(key => expect(declared, `"${key}" rejected by the ${name} def`).toContain(key));
    });

    it.each(['toggle', 'header'])('%s: marks isOpen as deprecated and ignored', (name) => {
      const isOpen = (defs[name].properties ?? {}).isOpen as { type?: string; deprecated?: boolean; description?: string } | undefined;

      expect(isOpen).toEqual({ type: 'boolean', deprecated: true, description: 'Ignored. Open state is personal and never saved.' });
    });
  });

  describe('table_of_contents', () => {
    it('saves only block color; the heading list is never stored', () => {
      const toc = defs.table_of_contents;

      expect(savedData.table_of_contents).toEqual({ textColor: 'red', backgroundColor: 'blue' });
      expect(toc.required ?? []).toEqual([]);
      expect(toc.additionalProperties).toBe(false);
      expect(Object.keys(toc.properties ?? {})).toEqual(['textColor', 'backgroundColor']);
    });
  });

  describe('tabs', () => {
    it('describes an empty tabs container and a tab with a required plain title and optional icon', () => {
      expect(defs.tabs).toMatchObject({ type: 'object', additionalProperties: false });
      expect(Object.keys(defs.tabs.properties ?? {})).toEqual([]);

      expect(defs.tab.required).toEqual(['title']);
      expect(defs.tab.additionalProperties).toBe(false);
      expect(Object.keys(defs.tab.properties ?? {})).toEqual(['title', 'icon']);
      expect(defs.tab.properties?.title).toMatchObject({ type: 'string' });
      expect(defs.tab.properties?.icon).toMatchObject({ type: 'string' });
    });

    it('routes tabs and tab to their defs', () => {
      const branches = (blockSchema.items as unknown as { allOf?: Array<{
        if: { properties: { type: { const: string } } };
        then: { properties: { data: { $ref: string } } };
      }> }).allOf ?? [];
      const routed = Object.fromEntries(
        branches.map(branch => [branch.if.properties.type.const, branch.then.properties.data.$ref])
      );

      expect(routed.tabs).toBe('#/$defs/tabs');
      expect(routed.tab).toBe('#/$defs/tab');
    });
  });

  describe('page-link', () => {
    it('requires a nonempty target and rejects saved metadata', () => {
      const link = defs['page-link'];

      expect(savedData['page-link']).toEqual({ pageId: 'p1' });
      expect(link.required).toEqual(['pageId']);
      expect(link.additionalProperties).toBe(false);
      expect(Object.keys(link.properties ?? {})).toEqual(['pageId']);
      expect(link.properties?.pageId).toMatchObject({ type: 'string', minLength: 1 });
    });
  });

  describe('values', () => {
    it.each(BUILT_IN_BLOCK_TOOLS)('%s: the maximal save() sample is valid data', (name) => {
      expect(validateAgainst(BUILT_IN_BLOCK_DESCRIPTIONS[name]({}).data, savedData[name])).toEqual([]);
    });

    it('accepts every markup item an image saved by v1.16.1 can hold', () => {
      const expected: ImageMarkup[] = [
        { id: 'm1', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.8], size: 0.012 },
        { id: 'm2', type: 'rect', color: '#0a84ff', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, size: 0.012, fill: true },
        { id: 'm3', type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.06, style: 'outline', rotation: 15 },
        { id: 'm4', type: 'rounded-rect', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
        { id: 'm5', type: 'bubble', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012, tx: 0.15, ty: 0.8 },
        { id: 'm6', type: 'star', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012, rotation: 30 },
        { id: 'm7', type: 'polygon', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
        { id: 'm8', type: 'spotlight', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
        { id: 'm9', type: 'magnifier', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
        { id: 'm10', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.8], size: 0.012, cut: 'both' },
        { id: 'm11', type: 'ellipse', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
        { id: 'm12', type: 'line', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
        { id: 'm13', type: 'arrow', color: '#0a84ff', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, size: 0.012 },
        { id: 'm14', type: 'highlighter', color: '#ffcc00', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.8], size: 0.036 },
      ];

      expect(validateAgainst(BUILT_IN_BLOCK_DESCRIPTIONS.image({}).data, savedData.image)).toEqual([]);
      expect(savedData.image.markup).toEqual(expected);
    });

    it('still accepts the old markup items unchanged', () => {
      const old = {
        url: 'https://x.y/a.png',
        markup: [
          { id: 'a', type: 'pen', color: '#ff0000', points: [0.1, 0.1, 0.5], size: 0.01 },
          { id: 'b', type: 'rect', color: '#00ff00', x1: 0, y1: 0, x2: 1, y2: 1, size: 0.02, fill: true },
          { id: 'c', type: 'text', color: '#0000ff', x: 0.5, y: 0.5, text: 'hi', size: 0.05 },
        ],
      };

      expect(validateAgainst(BUILT_IN_BLOCK_DESCRIPTIONS.image({}).data, old)).toEqual([]);
    });

    it.each([
      { tool: 'spacer', field: 'height', value: 20, path: '/height' },
      { tool: 'spacer', field: 'height', value: '40', path: '/height' },
      { tool: 'quote', field: 'size', value: 'huge', path: '/size' },
    ])('rejects malformed $tool.$field ($value) without normalizing it', ({ tool, field, value, path }) => {
      const description = BUILT_IN_BLOCK_DESCRIPTIONS[tool]({}).data;
      const valid = savedData[tool];
      const problems = validateAgainst(description, { ...valid, [field]: value });

      expect(problems.map(problem => problem.path)).toEqual([path]);
      expect(validateAgainst(description, valid)).toEqual([]);
    });

    it.each([
      { field: 'color', value: '#abc' },
      { field: 'size', value: 0 },
      { field: 'x1', value: '0.1' },
    ])('rejects malformed raw markup $field ($value)', ({ field, value }) => {
      const description = BUILT_IN_BLOCK_DESCRIPTIONS.image({}).data;
      const valid = {
        url: 'https://x.y/a.png',
        markup: [
          { id: 'control', type: 'rect', color: '#00ff00', x1: 0, y1: 0, x2: 1, y2: 1, size: 0.02 },
        ],
      };
      const invalid = { ...valid, markup: valid.markup.map(item => ({ ...item, [field]: value })) };
      const problems = validateAgainst(description, invalid);

      expect(problems.map(problem => problem.path)).toEqual(['/markup/0']);
      expect(validateAgainst(description, valid)).toEqual([]);
    });
  });

  describe('field drift', () => {
    /** Keys a def still accepts from older documents although save() no longer writes them. */
    const LEGACY_KEYS: Record<string, string[]> = {
      // v1.15.2 saved the open state; it is personal now and ignored on load.
      toggle: ['isOpen'],
      header: ['isOpen'],
    };

    it.each(BUILT_IN_BLOCK_TOOLS)('%s: schema properties match what save() emits', (name) => {
      const def = defs[name];
      const sample = savedData[name];

      expect(sample, `no save() sample for "${name}"`).toBeDefined();

      const savedKeys = Object.keys(sample).sort();
      const schemaKeys = Object.keys(def.properties ?? {})
        .filter(key => !(LEGACY_KEYS[name] ?? []).includes(key))
        .sort();

      // Forward: nothing the tool saves may be missing from the schema.
      savedKeys.forEach(key => expect(schemaKeys).toContain(key));

      // Reverse: an open def opts out (it cannot enumerate its fields);
      // a closed one must not declare a field the tool no longer saves.
      if (def.additionalProperties !== true) {
        expect(schemaKeys).toEqual(savedKeys);
      }
    });

    it('table: every key a saved cell carries is declared in the cell schema', () => {
      const cellBranches = (defs.table.properties?.content as { items: { items: { anyOf: (JsonSchema & { type: string })[] } } })
        .items.items.anyOf;
      const cellDef = cellBranches.find(branch => branch.type === 'object');
      const [[cell]] = (savedData.table as { content: Record<string, unknown>[][] }).content;

      Object.keys(cell).forEach(key => expect(Object.keys(cellDef?.properties ?? {})).toContain(key));
    });

    it('image: geometry and adjust fields carry their ranges', () => {
      const props = (defs.image.properties ?? {}) as Record<string, { enum?: unknown[]; minimum?: number; maximum?: number; additionalProperties?: boolean; properties?: Record<string, { minimum?: number; maximum?: number }> }>;

      expect(props.rotation?.enum).toEqual([0, 90, 180, 270]);
      expect(props.straighten).toMatchObject({ minimum: -45, maximum: 45 });
      // A host may define its own filters, so any non-empty name is valid.
      expect(props.filter).toMatchObject({ type: 'string', minLength: 1 });
      expect(props.filter?.enum).toBeUndefined();
      expect(props.filterStrength).toMatchObject({ minimum: 0, maximum: 100 });
      expect(props.adjust?.additionalProperties).toBe(false);
      expect(Object.keys(props.adjust?.properties ?? {}).sort()).toEqual(['brightness', 'contrast', 'saturation']);
      Object.values(props.adjust?.properties ?? {}).forEach(p => expect(p).toMatchObject({ minimum: -100, maximum: 100 }));
    });

    it('image: each markup branch declares exactly the fields its saved items carry', () => {
      type Branch = JsonSchema & { properties: Record<string, { const?: string; enum?: string[] }> };
      const markup = (defs.image.properties?.markup ?? {}) as JsonSchema & { items?: { anyOf?: Branch[] } };
      const branches = markup.items?.anyOf ?? [];
      const saved = (savedData.image.markup ?? []) as Array<Record<string, unknown> & { type: string }>;

      expect(saved).toHaveLength(14);
      saved.forEach((item) => {
        const branch = branches.find(b => b.properties.type.enum?.includes(item.type));

        expect(branch, `no branch for "${item.type}"`).toBeDefined();
        expect(branch?.additionalProperties).toBe(false);
        Object.keys(item).forEach(key => expect(Object.keys(branch?.properties ?? {})).toContain(key));
        (branch?.required ?? []).forEach(key => expect(item).toHaveProperty(key));
      });
      branches.forEach((branch) => {
        const actualKeys = [...new Set(saved
          .filter(item => branch.properties.type.enum?.includes(item.type))
          .flatMap(item => Object.keys(item)))];

        expect(Object.keys(branch.properties).sort()).toEqual(actualKeys.sort());
      });
      const savedKinds = [...new Set(saved.map(item => item.type))].sort();

      expect(savedKinds).toEqual(['arrow', 'bubble', 'ellipse', 'highlighter', 'line', 'magnifier', 'pen', 'polygon', 'rect', 'rounded-rect', 'spotlight', 'star', 'text']);
      expect(branches.flatMap(b => b.properties.type.enum ?? []).sort()).toEqual(savedKinds);
    });

    it.each(BUILT_IN_BLOCK_TOOLS)('%s: every required field is actually saved', (name) => {
      (defs[name].required ?? []).forEach(key => expect(savedData[name]).toHaveProperty(key));
    });
  });

  describe('envelope', () => {
    it('describes a document a real editor produces', async () => {
      const holder = document.createElement('div');

      document.body.appendChild(holder);

      const editor = new Blok({
        holder,
        tools: { paragraph: Paragraph, callout: Callout },
        data: {
          id: 'doc-1',
          blocks: [
            {
              id: 'c1', type: 'callout', data: { emoji: '💡' },
              lastEditedAt: 1712880000000, lastEditedBy: 'u1',
            },
            { id: 'p1', type: 'paragraph', parent: 'c1', data: { text: 'Hi' }, tunes: { indent: { level: 1 } } },
          ],
        },
      }) as unknown as { isReady: Promise<unknown>; save: () => Promise<OutputData>; destroy: () => void };

      try {
        await editor.isReady;

        const saved = await editor.save();
        const blockProperties = Object.keys((blockSchema.items ?? {}).properties ?? {});

        Object.keys(saved).forEach(key => expect(Object.keys(schema.properties ?? {})).toContain(key));
        expect(saved.id).toBe('doc-1');
        expect(typeof saved.time).toBe('number');
        expect(typeof saved.version).toBe('string');

        // The union across the fixture covers all eight saved block keys, so a
        // key the saver emits but the schema omits fails here.
        const savedBlockKeys = new Set(saved.blocks.flatMap(entry => Object.keys(entry)));

        expect([...savedBlockKeys].sort()).toEqual(blockProperties.sort());

        saved.blocks.forEach((entry) => {
          const def = defs[entry.type];

          Object.keys(entry.data).forEach(key => expect(Object.keys(def.properties ?? {})).toContain(key));
        });
      } finally {
        editor.destroy();
        holder.remove();
      }
    }, 60_000);

    const saveWithTitle = async (icon: Parameters<Title['icon']['set']>[0]): Promise<OutputData> => {
      const holder = document.createElement('div');

      document.body.appendChild(holder);

      const editor = new Blok({
        holder,
        pageTitle: true,
        tools: { paragraph: Paragraph },
        data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hi' } }] },
      }) as unknown as { isReady: Promise<unknown>; save: () => Promise<OutputData>; destroy: () => void; title: Title };

      try {
        await editor.isReady;
        editor.title.set('Plan');
        editor.title.icon.set(icon);

        return await editor.save();
      } finally {
        editor.destroy();
        holder.remove();
      }
    };

    it('accepts a saved document with a title and an emoji icon', async () => {
      const saved = await saveWithTitle({ type: 'emoji', value: '🚀' });

      expect(validateAgainst(blokDocumentSchema, saved)).toEqual([]);
      expect(saved.title).toBe('Plan');
      expect(saved.icon).toEqual({ type: 'emoji', value: '🚀' });
      expect(Object.keys(saved).sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
    }, 60_000);

    it('accepts a saved document with an image icon', async () => {
      const saved = await saveWithTitle({ type: 'image', url: 'https://x/y.png' });

      expect(validateAgainst(blokDocumentSchema, saved)).toEqual([]);
      expect(saved.icon).toEqual({ type: 'image', url: 'https://x/y.png' });
    }, 60_000);

    it('still rejects an unknown top-level key', () => {
      expect(validateAgainst(blokDocumentSchema, { blocks: [], extra: 1 })).not.toEqual([]);
    });
  });
});
