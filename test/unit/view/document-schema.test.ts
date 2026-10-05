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
  Toggle,
  Video,
  defaultBlockTools,
} from '../../../src/tools';
import { blokDocumentSchema } from '../../../src/view/document-schema';

import type { API, BlockToolConstructorOptions, OutputData } from '../../../types';

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
      text: 'Title', level: 2, isToggleable: true, isOpen: true,
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
    const tool = new Toggle(options({ text: 'Summary', isOpen: true }));

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
  'database-row': new DatabaseRow(options({ properties: { p1: 'Ship it' }, position: 'a0', title: 'Ship it', pageId: 'row-page' }))
    .save(contentElement('')),

  page: new Page(options({ pageId: 'p1', textColor: 'red', backgroundColor: 'blue', cache: { title: 'Roadmap', icon: { type: 'emoji', value: '🗺' } } })).save(),
  'page-link': new PageLink(options({ pageId: 'p1' })).save(),

  divider: new Divider(options({})).save(),

  spacer: new Spacer(options({ height: 40 })).save(),

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
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['blocks', 'time', 'version']);
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

  describe('field drift', () => {
    it.each(BUILT_IN_BLOCK_TOOLS)('%s: schema properties match what save() emits', (name) => {
      const def = defs[name];
      const sample = savedData[name];

      expect(sample, `no save() sample for "${name}"`).toBeDefined();

      const savedKeys = Object.keys(sample).sort();
      const schemaKeys = Object.keys(def.properties ?? {}).sort();

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

    it('image: each markup item branch declares exactly what a saved item of that type carries', () => {
      type Branch = JsonSchema & { properties: Record<string, { const?: string; enum?: string[] }> };
      const markup = (defs.image.properties?.markup ?? {}) as JsonSchema & { items?: { anyOf?: Branch[] } };
      const branches = markup.items?.anyOf ?? [];
      const saved = (savedData.image.markup ?? []) as Array<Record<string, unknown> & { type: string }>;

      expect(saved).toHaveLength(3);
      saved.forEach((item) => {
        const branch = branches.find(b => b.properties.type.enum?.includes(item.type));

        expect(branch, `no branch for "${item.type}"`).toBeDefined();
        expect(branch?.additionalProperties).toBe(false);
        expect(Object.keys(branch?.properties ?? {}).sort()).toEqual(Object.keys(item).sort());
        (branch?.required ?? []).forEach(key => expect(item).toHaveProperty(key));
      });
      expect(branches.flatMap(b => b.properties.type.enum ?? []).sort())
        .toEqual(['arrow', 'ellipse', 'highlighter', 'line', 'pen', 'rect', 'text']);
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

        expect(Object.keys(saved).sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
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
  });
});
