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
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  $defs?: Record<string, JsonSchema>;
};

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

const options = <D, C>(data: D, config?: C): BlockToolConstructorOptions<D, C> => ({
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

  'database-row': new DatabaseRow(options({ properties: { p1: 'Ship it' }, position: 'a0' }))
    .save(contentElement('')),

  divider: new Divider(options({})).save(),

  spacer: new Spacer(options({ height: 40 })).save(),

  quote: new Quote(options({ text: 'Wise words', size: 'large' })).save(
    contentElement('Wise words') as unknown as HTMLQuoteElement
  ),

  code: new Code(options({ code: 'x = 1', language: 'python', lineNumbers: true })).save(contentElement('')),

  image: new ImageTool(options({
    url: 'https://example.com/a.png', caption: 'Cap', width: 50, alignment: 'left',
    alt: 'Alt', fileName: 'a.png', size: 'md', frame: 'border', rounded: true,
    captionVisible: true, naturalWidth: 800, naturalHeight: 600,
    crop: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' },
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
     * `defaultBlockTools` is the registry, so the comparison is bidirectional:
     * a new tool without a def AND a def left behind by a removed tool both fail.
     */
    it('has exactly one $defs entry per built-in block tool', () => {
      expect(Object.keys(defs).sort()).toEqual(Object.keys(defaultBlockTools).sort());
    });

    it('routes every built-in type to its own def', () => {
      const branches = (blockSchema.items as unknown as { allOf?: Array<{
        if: { properties: { type: { const: string } } };
        then: { properties: { data: { $ref: string } } };
      }> }).allOf ?? [];
      const routed = Object.fromEntries(
        branches.map(branch => [branch.if.properties.type.const, branch.then.properties.data.$ref])
      );

      Object.keys(defaultBlockTools).forEach((name) => {
        expect(routed[name]).toBe(`#/$defs/${name}`);
      });
    });
  });

  describe('field drift', () => {
    it.each(Object.keys(defaultBlockTools))('%s: schema properties match what save() emits', (name) => {
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

    it.each(Object.keys(defaultBlockTools))('%s: every required field is actually saved', (name) => {
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
