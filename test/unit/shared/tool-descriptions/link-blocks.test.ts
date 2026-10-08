import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { unknownKeywords, validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';
import { BOOKMARK_DATA, describeBookmark } from '../../../../src/shared/tool-descriptions/bookmark';
import { describeEmbed, EMBED_DATA } from '../../../../src/shared/tool-descriptions/embed';
import { describePage, PAGE_DATA } from '../../../../src/shared/tool-descriptions/page';
import { describePageLink, PAGE_LINK_DATA } from '../../../../src/shared/tool-descriptions/page-link';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import type { BlokSchema, BlockToolDescription, DescribeBlockTool } from '../../../../types/tools/tool-description';
import { BLOCK_CLASSES } from './built-in-tools';

type LinkBlockName = 'embed' | 'bookmark' | 'page' | 'page-link';

const LINK_CLASSES: Array<{ name: LinkBlockName; toolClass: unknown }> = [
  { name: 'embed', toolClass: BLOCK_CLASSES.embed },
  { name: 'bookmark', toolClass: BLOCK_CLASSES.bookmark },
  { name: 'page', toolClass: BLOCK_CLASSES.page },
  { name: 'page-link', toolClass: BLOCK_CLASSES['page-link'] },
];

const hasDescribe = (tool: unknown): tool is { describe: DescribeBlockTool } =>
  typeof tool === 'function' && 'describe' in tool && typeof tool.describe === 'function';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('link block descriptions', () => {
  it.each(LINK_CLASSES)('$name is registered for discovery', ({ name }) => {
    expect(typeof BUILT_IN_BLOCK_DESCRIPTIONS[name], name).toBe('function');
  });

  it.each(LINK_CLASSES)('$name exposes the shared description through its real class', ({ name, toolClass }) => {
    expect(hasDescribe(toolClass), name).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error(`${name} must expose describe.`);
    }

    const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];

    expect(typeof describeTool, name).toBe('function');

    if (describeTool === undefined) {
      throw new Error(`Missing description for ${name}.`);
    }

    expect(toolClass.describe).toBe(describeTool);
    expect(toolClass.describe({})).toEqual(describeTool({}));
  });
});

type LinkDescriptionCase = {
  name: LinkBlockName;
  describeTool: (config?: Record<string, unknown>) => BlockToolDescription;
  dataSchema: BlokSchema;
  summary: string;
  guidance: string;
  summaryFields: string[];
  starter: Record<string, unknown>;
  accepted: Array<{ label: string; data: unknown }>;
  rejected: Array<{ label: string; data: unknown }>;
};

const LINK_DESCRIPTIONS: LinkDescriptionCase[] = [
  {
    name: 'embed',
    describeTool: describeEmbed,
    dataSchema: EMBED_DATA,
    summary: 'A live embed from a known provider (YouTube, Figma, …).',
    guidance: 'Set or change the URL with embed.setUrl: it finds the provider and fills service, embed and kind. Never write embed yourself. caption is plain text.',
    summaryFields: ['service', 'source'],
    starter: { service: 'youtube', source: 'https://youtu.be/x', embed: 'https://www.youtube.com/embed/x' },
    accepted: [
      { label: 'empty required strings', data: { service: '', source: '', embed: '' } },
      { label: 'minimal provider-shaped data', data: { service: 'youtube', source: 'https://youtu.be/x', embed: 'https://www.youtube.com/embed/x' } },
      { label: 'lower percent and optional fields', data: { service: 'custom-service', source: 'not a URL', embed: 'http://example.com/frame', kind: 'script', width: -10, height: 0, widthPercent: 10, alignment: 'left', caption: '<b>literal caption</b>', captionVisible: false } },
      { label: 'upper percent and iframe kind', data: { service: 'youtube', source: 'https://youtu.be/x', embed: 'https://www.youtube.com/embed/x', kind: 'iframe', widthPercent: 100, alignment: 'right', caption: '', captionVisible: true } },
    ],
    rejected: [
      { label: 'missing service', data: { source: '', embed: '' } },
      { label: 'missing source', data: { service: '', embed: '' } },
      { label: 'missing embed', data: { service: '', source: '' } },
      { label: 'unknown saved field', data: { service: '', source: '', embed: '', surprise: true } },
      { label: 'unsupported kind', data: { service: '', source: '', embed: '', kind: 'unknown' } },
      { label: 'percent below lower boundary', data: { service: '', source: '', embed: '', widthPercent: 9 } },
      { label: 'percent above upper boundary', data: { service: '', source: '', embed: '', widthPercent: 101 } },
      { label: 'unsupported alignment', data: { service: '', source: '', embed: '', alignment: 'start' } },
      { label: 'segments in a string caption', data: { service: '', source: '', embed: '', caption: [{ text: 'Caption' }] } },
      { label: 'non-number dimensions', data: { service: '', source: '', embed: '', width: '580', height: '320' } },
      { label: 'non-boolean caption visibility', data: { service: '', source: '', embed: '', captionVisible: 1 } },
      { label: 'non-string source', data: { service: '', source: 12, embed: '' } },
    ],
  },
  {
    name: 'bookmark',
    describeTool: describeBookmark,
    dataSchema: BOOKMARK_DATA,
    summary: 'A link preview card.',
    guidance: 'Create one with bookmark.create: it fetches title, description and image. Do not invent preview fields.',
    summaryFields: ['url', 'title'],
    starter: { url: 'https://example.com' },
    accepted: [
      { label: 'empty url', data: { url: '' } },
      { label: 'minimal saved data', data: { url: 'https://example.com' } },
      { label: 'all preview fields', data: { url: 'https://example.com', title: 'Title', description: 'Description', image: 'https://example.com/og.png', favicon: 'https://example.com/f.ico', domain: 'example.com' } },
      { label: 'descriptive guidance adds no URL or markup validator', data: { url: 'not a URL', title: '<b>literal title</b>', description: '', image: '', favicon: '', domain: '' } },
    ],
    rejected: [
      { label: 'missing url', data: {  } },
      { label: 'unknown saved field', data: { url: '', surprise: true } },
      { label: 'non-string url', data: { url: 12 } },
      { label: 'non-string title', data: { url: '', title: [{ text: 'Title' }] } },
      { label: 'non-string preview image', data: { url: '', image: null } },
    ],
  },
  {
    name: 'page',
    describeTool: describePage,
    dataSchema: PAGE_DATA,
    summary: 'A sub-page. Its body is a separate document named by pageId.',
    guidance: 'Inserting a page asks the host to create the page document. To rename the page this block points to, or change its icon, use page.rename or page.setIcon. To change the title of the document you are editing, use doc.setTitle.',
    summaryFields: ['pageId'],
    starter: { pageId: 'p1' },
    accepted: [
      { label: 'empty pointer string', data: { pageId: '' } },
      { label: 'pointer with saved block colors', data: { pageId: 'p1', textColor: 'red', backgroundColor: 'blue' } },
      { label: 'color guidance adds no preset enum', data: { pageId: 'p1', textColor: 'custom-ink', backgroundColor: '' } },
    ],
    rejected: [
      { label: 'missing pointer', data: {  } },
      { label: 'non-string pointer', data: { pageId: 12 } },
      { label: 'target title is not block data', data: { pageId: 'p1', title: 'Roadmap' } },
      { label: 'target icon is not block data', data: { pageId: 'p1', icon: { type: 'emoji', value: 'map' } } },
      { label: 'legacy cache is not saved data', data: { pageId: 'p1', cache: { title: 'Roadmap' } } },
      { label: 'non-string text color', data: { pageId: 'p1', textColor: 12 } },
      { label: 'null background color', data: { pageId: 'p1', backgroundColor: null } },
    ],
  },
  {
    name: 'page-link',
    describeTool: describePageLink,
    dataSchema: PAGE_LINK_DATA,
    summary: 'A link to an existing page. It owns nothing.',
    guidance: 'pageId must name a page that exists. To make a new page, insert a page block instead.',
    summaryFields: ['pageId'],
    starter: { pageId: 'p1' },
    accepted: [
      { label: 'minimal reference', data: { pageId: 'p1' } },
      { label: 'minLength does not trim whitespace or resolve existence', data: { pageId: ' ' } },
    ],
    rejected: [
      { label: 'empty pointer string', data: { pageId: '' } },
      { label: 'missing pointer', data: {  } },
      { label: 'non-string pointer', data: { pageId: 12 } },
      { label: 'reference does not save a title', data: { pageId: 'p1', title: 'Roadmap' } },
      { label: 'reference does not save an icon', data: { pageId: 'p1', icon: { type: 'emoji', value: 'map' } } },
      { label: 'reference does not save block colors', data: { pageId: 'p1', textColor: 'red' } },
    ],
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

describe('link self-description metadata and saved schemas', () => {
  it.each(LINK_DESCRIPTIONS)('$name shares its independent published schema', ({ name, describeTool, dataSchema }) => {
    const published: unknown = JSON.parse(readFileSync(
      resolve(__dirname, '../../view/__snapshots__/document-schema.json'),
      'utf8'
    ));

    if (!isRecord(published) || !isRecord(published.$defs)) {
      throw new Error('Published schema must expose $defs.');
    }

    expect(dataSchema).toEqual(published.$defs[name]);
    expect(describeTool().data).toBe(dataSchema);
    expect(blokDocumentSchema.$defs[name]).toBe(dataSchema);
    expect(BUILT_IN_BLOCK_DESCRIPTIONS[name]).toBe(describeTool);
    expect(unknownKeywords(dataSchema)).toEqual([]);
    expect(blokDocumentSchema.properties.blocks.items.allOf).toContainEqual({
      if: { required: ['type'], properties: { type: { const: name } } },
      then: { properties: { data: { $ref: `#/$defs/${name}` } } },
    });
  });

  it.each(LINK_DESCRIPTIONS)('$name describes exactly the approved fields and plain guidance', ({
    describeTool, dataSchema, summary, guidance, summaryFields,
  }) => {
    const description = describeTool();

    expect(description).toEqual({ summary, guidance, data: dataSchema, summaryFields });
    expect(description.guidance).not.toMatch(/<[^>]+>|\x60\x60\x60/);
  });

  it.each(LINK_DESCRIPTIONS)('$name admits minimal saved data without inventing a starter', ({ describeTool, starter }) => {
    const description = describeTool();

    expect(validateAgainst(description.data, starter)).toEqual([]);
    expect(description.defaultData).toBeUndefined();
    expect(description.examples).toBeUndefined();
  });

  it.each(LINK_DESCRIPTIONS)('$name is pure, config-immutable and JSON-safe', ({ describeTool, dataSchema }) => {
    const create = vi.fn();
    const resolvePage = vi.fn();
    const rename = vi.fn();
    const setIcon = vi.fn();
    const headers = vi.fn();
    const nested = Object.freeze({ keep: true });
    const origins = Object.freeze(['https://example.com']);
    const config = Object.freeze({
      endpoint: 'https://example.com/unfurl',
      headers,
      create,
      resolve: resolvePage,
      rename,
      setIcon,
      nested,
      allowedEmbedOrigins: origins,
    });
    const before = { ...config };
    const schemaBefore = JSON.stringify(dataSchema);
    const description = describeTool(config);
    const roundTrip: unknown = JSON.parse(JSON.stringify(description));

    expect(config).toEqual(before);
    expect(config.nested).toBe(nested);
    expect(config.allowedEmbedOrigins).toBe(origins);
    expect(description).toEqual(describeTool());
    expect(description.data).toBe(dataSchema);
    expect(JSON.stringify(dataSchema)).toBe(schemaBefore);
    expect(roundTrip).toEqual(description);

    for (const hook of [create, resolvePage, rename, setIcon, headers]) {
      expect(hook).not.toHaveBeenCalled();
    }
  });

  it.each(LINK_DESCRIPTIONS)('$name preserves accepted saved-schema boundaries', ({ describeTool, accepted }) => {
    for (const { label, data } of accepted) {
      expect(validateAgainst(describeTool().data, data), label).toEqual([]);
    }
  });

  it.each(LINK_DESCRIPTIONS)('$name preserves rejected saved-schema boundaries', ({ describeTool, rejected }) => {
    for (const { label, data } of rejected) {
      expect(validateAgainst(describeTool().data, data).length, label).toBeGreaterThan(0);
    }
  });
});
