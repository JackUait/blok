/**
 * Every Blok call site whose output goes through parse5, fed from the shared
 * parser corpus. call-site-goldens.test.ts records what each returns today so
 * the move to src/html can prove it changes nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { OutputBlockData, OutputData, SanitizerConfig } from '../../../types';
import type { TagConfig } from '../../../types/configs/sanitizer-config';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { migrateToRichText, richTextToPlainText } from '../../../src/migrate';
import { INLINE_TEXT_SANITIZE } from '../../../src/shared/inline-text-sanitize';
import { protectPageReferenceAnchor } from '../../../src/shared/page-reference';
import { outputBlocksToSegments } from '../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';
import { defineBlokSchema } from '../../../src/shared/sanitize-schema';
import { PLAINTEXT } from '../../../src/shared/sanitize-rules';
import { CELL_BLOCK_TAGS_SANITIZE } from '../../../src/shared/table/cell-sanitize';
import { BUILT_IN_BLOCK_SANITIZE } from '../../../src/shared/tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from '../../../src/shared/tool-descriptions/sanitize/inline';
import { blocksToHtml } from '../../../src/view/blocks-to-html';
import type { BlocksToHtmlOptions } from '../../../src/view/blocks-to-html';
import { blocksToMarkdownWithReport } from '../../../src/view/blocks-to-markdown';
import { blocksToPlainTextWithReport, collectPageIndexBlocks } from '../../../src/view/blocks-to-plain-text';
import { diffOutputData } from '../../../src/view/diff-output-data';
import { extractTexts, injectTexts } from '../../../src/view/document-texts';
import { htmlTextContent, proseTextContent } from '../../../src/view/html-text';
import { htmlToBlocksWithReport } from '../../../src/view/html-to-blocks';
import { applyInlineRenderers } from '../../../src/view/inline-renderers';
import type { ViewInlineRenderer } from '../../../src/view/inline-renderers';
import { outlineFromOutputData } from '../../../src/view/outline';
import { remapPageDocument } from '../../../src/view/page-document-remap';
import { pageIndex } from '../../../src/view/page-index';
import { restoreHeadingAnchors } from '../../../src/view/restore-heading-anchors';
import { htmlToSegmentsNode, parseInlineHtmlNode } from '../../../src/view/rich-text-node';
import { escapeHtml, sanitizeHtmlFragment } from '../../../src/view/sanitize';
import { blocksToViewNodes } from '../../../src/view/view-nodes';
import { fuzzHtml, realDocuments, storedFields, treeConstructionInputs } from './corpus';

/**
 * Call sites that read the same inputs. Stored as one file, inputs included,
 * row by row, so sibling outputs sit next to each other and gzip folds them.
 * The compare run reads the inputs back from the file: the corpus and the
 * stored documents it is built from may change after the parser migration.
 */
export interface GoldenGroup {
  name: string;
  /** Builds the inputs from the corpus; only the recorder calls it. */
  liveInputs: () => unknown[];
  suites: Array<{ name: string; run: (input: unknown) => unknown }>;
}

/** A document row: the fields a built page holds, or a stored document as it is. */
type DocumentInput = { fields: string[]; seq: number } | { stored: string; data: OutputData };

const ROOT = join(__dirname, '..', '..', '..');
const FUZZ_SEEDS = 3000;

/** Lone surrogates in every place a field can hold one; most hold two lows in a row, which parse5 throws on. */
export const SURROGATE_CASES = [
  'a\uDC00\uDC00b',
  '<a href="x\uDC00\uDC00y">t</a>',
  '<p title="\uDC00\uDC00">a\uD800</p>',
  '<b>\uDC00\uDC00</b>&amp;',
  '<!-- \uDC00\uDC00 -->x',
  '<style>\uDC00\uDC00</style>y',
  '<!DOCTYPE html \uDC00\uDC00>z',
  '<span data-blok-page-id="p\uDC00\uDC00">x</span>',
  '<a href="#\uDC00\uDC00">h</a>',
  '<a data-blok-page-id="pg">\uDC00\uDC00</a>',
  '<span data-latex="\uDC00\uDC00">m</span>',
  '𐀀\uDC00&lt;',
  '\uD800𐀀\uDC00<i>a</i>',
  '\uDC00𐀀<i>a</i>',
  'x\uDC00 <u>y</u>\uD800',
];

/**
 * Fragment-sized inputs: stored fields, html5lib inputs, fuzz and the surrogate
 * cases. Whole pages are not fields: the sanitizer's walk overflows the stack
 * on most of them, and where that happens depends on the engine's stack size.
 */
export const fragmentInputs = (): string[] => [
  ...storedFields(),
  ...treeConstructionInputs(),
  ...Array.from({ length: FUZZ_SEEDS }, (_, seed) => fuzzHtml(seed)),
  ...SURROGATE_CASES,
];

const describeError = (error: unknown): { error: string; message?: string } => {
  if (!(error instanceof Error)) {
    return { error: String(error) };
  }

  // parse5's own message names the code point; the new parser only has to throw the same kind.
  // A stack overflow is a RangeError too, and must not pass for one.
  return error instanceof RangeError && !error.message.includes('call stack')
    ? { error: error.name }
    : { error: error.name, message: error.message };
};

/** The recorded shape: a value, or the error the call threw. */
export const capture = (run: () => unknown): unknown => {
  try {
    return { ok: run() };
  } catch (error) {
    return describeError(error);
  }
};

const inlineToolStandIns = (): Record<string, unknown> => Object.fromEntries(
  Object.entries(BUILT_IN_INLINE_SANITIZE).map(([name, sanitize]) => [name, class {
    public static isInline = true;
    public static sanitize = sanitize();
    public render(): void {}
  }])
);

/** The composed allowlist an editor built with every built-in inline tool hands the view. */
const schemaBaseSanitize = (): SanitizerConfig =>
  defineBlokSchema({ tools: inlineToolStandIns() as never }).viewSchema.baseSanitize;

const blockFieldConfig = (tool: string, field: string): SanitizerConfig =>
  (BUILT_IN_BLOCK_SANITIZE[tool]() as Record<string, SanitizerConfig>)[field];

/** Hand-written configs, one per rule shape the sanitizer resolves. */
const HAND_CONFIGS: Record<string, SanitizerConfig> = {
  'true-rules': {
    b: true, i: true, a: true, p: true, div: true, span: true, li: true, ul: true, table: true, tbody: true,
    tr: true, td: true, template: true, img: true, svg: true, br: true, style: true, script: true,
  },
  'false-rules': { b: false, i: {}, a: false, p: {}, div: false },
  'attr-maps': {
    a: { href: true, target: '_blank', rel: 'noopener' },
    span: { class: 'x', style: true, 'data-blok-x': true },
    img: { src: true, alt: true },
    td: { colspan: true, style: true },
    p: {},
  },
  'function-rules': {
    a: (el: Element) => (el.getAttribute('href') === null ? false : { href: true, rel: 'nofollow' }),
    span: (el: Element) => {
      el.classList.remove('x');
      (el as HTMLElement).style.removeProperty('color');

      return { class: true, style: true, title: el.textContent ?? '' };
    },
    b: () => true,
    i: () => false,
    u: () => ({}),
    mark: (el: Element) => {
      // eslint-disable-next-line no-param-reassign -- exercises the textContent setter of the facade
      el.textContent = `[${el.textContent ?? ''}]`;

      return { style: true };
    },
    p: (el: Element): TagConfig => (el.hasAttribute('style') ? { style: true } : {}),
  },
  'malformed-rule': { b: PLAINTEXT, i: 'x' as never, s: true },
  empty: {},
};

/** Every sanitizer config the repo hands the view, plus the hand-written shapes. */
export const sanitizerConfigs = (): Record<string, SanitizerConfig | typeof PLAINTEXT> => ({
  'inline-text': INLINE_TEXT_SANITIZE,
  'schema-base': schemaBaseSanitize(),
  'headless-anchor': {
    ...INLINE_TEXT_SANITIZE,
    a: protectPageReferenceAnchor((INLINE_TEXT_SANITIZE as Record<string, never>).a),
  },
  'paragraph-text': blockFieldConfig('paragraph', 'text'),
  'header-text': blockFieldConfig('header', 'text'),
  'table-content': blockFieldConfig('table', 'content'),
  'cell-block-tags': CELL_BLOCK_TAGS_SANITIZE,
  ...HAND_CONFIGS,
  plaintext: PLAINTEXT,
});

const proxyUrl = (url: string): string => (url.startsWith('http') ? `https://proxy.test/?u=${encodeURIComponent(url)}` : url);

const INLINE_RENDERERS: Record<string, ViewInlineRenderer> = {
  span: (el) => (el.attrs['data-latex'] === undefined ? undefined : `<x-math>${escapeHtml(el.attrs['data-latex'])}</x-math>`),
  mark: () => '',
  code: (el) => `<kbd title="${escapeHtml(el.text)}">${el.html}</kbd>`,
  a: (el) => (el.attrs.href?.startsWith('#') ? `<a href="${escapeHtml(el.attrs.href)}">${el.html}<i>#</i></a>` : undefined),
  b: () => null,
  p: (el) => `<p>${el.html}</p><p>`,
};

const rawField = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Block renderers that print a field's stored markup unsanitized, as a host's own renderer may. */
const RAW_RENDERERS: BlocksToHtmlOptions['renderers'] = {
  paragraph: (data) => `<section data-raw="1">${rawField(data.text)}</section>`,
  quote: (data) => rawField(data.text),
};

const PAGE_OPTIONS: BlocksToHtmlOptions = {
  pageHref: (pageId) => `/pages/${pageId}`,
  pageInfo: (pageId) => (pageId.endsWith('0') ? { access: 'none' } : { title: `Title of ${pageId}` }),
};

/** One option set per branch of blocksToHtml that reaches the parser differently. */
export const htmlOptionSets = (): Record<string, BlocksToHtmlOptions> => ({
  default: {},
  schema: { schema: defineBlokSchema({ tools: inlineToolStandIns() as never }).viewSchema },
  'inline-renderers': { inlineRenderers: INLINE_RENDERERS },
  rtl: { direction: 'rtl' },
  pages: PAGE_OPTIONS,
  'transform-url': { transformUrl: (url) => proxyUrl(url) },
  stamps: { toolAttributes: true, blockIds: true, classes: true, onUnknownBlock: 'comment', root: true, title: true },
  renderers: { renderers: RAW_RENDERERS },
});

/** A realistic page whose rich fields hold `fields`, in every place a built-in tool keeps inline HTML. */
export const documentFor = (fields: readonly string[], seq: number): OutputData => {
  const field = (index: number): string => fields[index % fields.length];
  const id = (name: string): string => `${name}-${seq}`;
  const blocks: OutputBlockData[] = [
    { id: id('h2'), type: 'header', data: { text: field(0), level: 2 } },
    { id: id('toc'), type: 'table_of_contents', data: {} },
    { id: id('p1'), type: 'paragraph', data: { text: field(1) } },
    {
      id: id('links'),
      type: 'paragraph',
      data: {
        text: `See <a href="#dead-${seq}">${field(0)}</a>, <a href="#${id('h2')}">${field(2)}</a> and <a data-blok-page-id="pg-${seq}">${field(3)}</a>.`,
      },
    },
    { id: id('quote'), type: 'quote', data: { text: field(4), size: 'default' } },
    { id: id('ul'), type: 'list', data: { style: 'unordered', text: field(5) } },
    { id: id('ol'), type: 'list', data: { style: 'ordered', text: field(6) } },
    { id: id('todo'), type: 'list', data: { style: 'checklist', text: field(7), checked: seq % 2 === 0 } },
    { id: id('toggle'), type: 'toggle', data: { text: field(8), isOpen: true }, content: [id('toggle-child')] },
    { id: id('toggle-child'), type: 'paragraph', data: { text: field(9) }, parent: id('toggle') },
    { id: id('callout'), type: 'callout', data: { emoji: '💡' }, content: [id('callout-child')] },
    { id: id('callout-child'), type: 'paragraph', data: { text: field(10) }, parent: id('callout') },
    { id: id('table'), type: 'table', data: { withHeadings: true, content: [[field(11), field(12)], [field(13), field(14)]] } },
    { id: id('h3'), type: 'header', data: { text: field(2), level: 3 } },
    { id: id('image'), type: 'image', data: { url: 'https://example.test/a.png', caption: field(15), alt: 'alt' } },
    { id: id('code'), type: 'code', data: { code: field(16), language: 'html' } },
    { id: id('page'), type: 'page', data: { pageId: `pg-${seq}`, cache: { title: field(17) } } },
    { id: id('unknown'), type: 'x-unknown', data: { text: field(18) } },
  ];

  return { time: 0, version: 'golden', blocks };
};

const SEGMENT_FIELDS = (type: string): string[] =>
  Object.hasOwn(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

const ID_KEYS = new Set(['id', 'parent', 'parentId']);
const ID_LIST_KEYS = new Set(['content', 'contentIds']);

/** Every block and page id in a document, mapped to a new one, as a page copy would. */
const remapIdsFor = (data: OutputData): Parameters<typeof remapPageDocument>[1] => {
  const blockIds = new Map<string, string>();
  const pageIds = new Map<string, string>();
  const add = (map: Map<string, string>, value: unknown): void => {
    if (typeof value === 'string' && value !== '') {
      map.set(value, `new:${value}`);
    }
  };
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') {
      return;
    }
    Object.entries(value).forEach(([key, child]) => {
      if (ID_KEYS.has(key)) {
        add(blockIds, child);
      }
      if (key === 'pageId') {
        add(pageIds, child);
      }
      if (ID_LIST_KEYS.has(key) && Array.isArray(child)) {
        child.forEach((item) => add(blockIds, item));
      }
      visit(child);
    });
  };

  visit(data.blocks);

  return { blockIds, pageIds };
};

const DOCUMENT_FUNCTIONS: Record<string, (data: OutputData, shifted: OutputData) => unknown> = {
  ...Object.fromEntries(Object.entries(htmlOptionSets()).map(([name, options]) => [
    `blocksToHtml:${name}`,
    (data: OutputData) => blocksToHtml(data, options),
  ])),
  'blocksToViewNodes:default': (data) => blocksToViewNodes(data),
  'blocksToViewNodes:stamps': (data) => blocksToViewNodes(data, htmlOptionSets().stamps),
  blocksToPlainTextWithReport: (data) => blocksToPlainTextWithReport(data, { title: true }),
  'blocksToViewNodes:renderers': (data) => blocksToViewNodes(data, { renderers: RAW_RENDERERS }),
  'blocksToPlainTextWithReport:renderers': (data) => blocksToPlainTextWithReport(data, { renderers: RAW_RENDERERS }),
  collectPageIndexBlocks: (data) => collectPageIndexBlocks(data),
  'blocksToMarkdownWithReport:default': (data) => blocksToMarkdownWithReport(data),
  'blocksToMarkdownWithReport:pages': (data) => blocksToMarkdownWithReport(data, { ...PAGE_OPTIONS, title: true }),
  outlineFromOutputData: (data) => outlineFromOutputData(data),
  restoreHeadingAnchors: (data) => restoreHeadingAnchors(data),
  pageIndex: (data) => pageIndex(data),
  remapPageDocument: (data) => remapPageDocument(data, remapIdsFor(data)),
  diffOutputData: (data, shifted) => diffOutputData(data, shifted),
  migrateToRichText: (data) => {
    const lossy: unknown[] = [];
    const migrated = migrateToRichText(data, { onLossy: (report) => lossy.push(report) });

    return { migrated, lossy };
  },
  injectTexts: (data, shifted) => {
    const segments = migrateToRichText(data);
    const texts = extractTexts(shifted);

    return injectTexts(segments, extractTexts(segments).map((_, index) => texts[index % texts.length]));
  },
  outputBlocksToSegments: (data) => outputBlocksToSegments(data.blocks, SEGMENT_FIELDS, htmlToSegmentsNode),
};

/** A low surrogate right after another one: the fields that can make a whole document throw today. */
const RISKY = /[\uDC00-\uDFFF][\uDC00-\uDFFF]/;
const SLOTS = 19;
const RISKY_DOCUMENTS = 80;

const listFiles = (dir: string, name: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return listFiles(path, name);
    }

    return entry.name === name ? [path] : [];
  });

/** Stored Blok documents: the playground, its pages, and the collab canonical documents. */
const storedDocuments = (): Array<{ name: string; data: OutputData }> => {
  const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
  const pages = read(join(ROOT, 'playground-pages.json')) as Record<string, OutputData>;
  const canonical = listFiles(join(ROOT, 'test', 'unit', 'server-conformance', 'fixtures'), 'canonical.json')
    .map((path) => ({ name: path.slice(ROOT.length + 1), blocks: read(path) }))
    .filter((doc): doc is { name: string; blocks: OutputBlockData[] } => Array.isArray(doc.blocks))
    .map(({ name, blocks }) => ({ name, data: { blocks } }));

  return [
    { name: 'playground-document.json', data: { blocks: read(join(ROOT, 'playground-document.json')) as OutputBlockData[] } },
    ...Object.entries(pages).map(([name, data]) => ({ name: `playground-pages.json#${name}`, data })),
    ...canonical,
  ];
};

/**
 * Documents: sliding windows over the safe fields, one document per risky field
 * (capped: the fragment suites already pin every one), and the stored documents.
 */
export const documentInputs = (fields: readonly string[]): DocumentInput[] => {
  const safe = fields.filter((html) => !RISKY.test(html));
  const handWritten = (html: string): number => Number(SURROGATE_CASES.includes(html));
  const risky = fields
    .filter((html) => RISKY.test(html))
    .sort((a, b) => handWritten(b) - handWritten(a))
    .slice(0, RISKY_DOCUMENTS);
  const windows = Array.from({ length: Math.ceil(safe.length / SLOTS) }, (_, index) => safe.slice(index * SLOTS, (index + 1) * SLOTS));

  return [
    ...[...windows, ...risky.map((html) => [html])].map((own, seq) => ({ fields: own, seq })),
    ...storedDocuments().map(({ name, data }) => ({ stored: name, data })),
  ];
};

/** The document a row stands for, and the one `diffOutputData` and `injectTexts` compare it with. */
const documentPair = (input: unknown): { data: OutputData; shifted: OutputData } => {
  const row = input as DocumentInput;

  if ('stored' in row) {
    return { data: row.data, shifted: row.data };
  }

  return {
    data: documentFor(row.fields, row.seq),
    shifted: documentFor([...row.fields.slice(1), row.fields[0]], row.seq),
  };
};

const PAGE_TEXT = (pageId: string): string => `«${pageId}»`;

const serializer = new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode });

/** Fragment-level call sites, keyed by the name the fixture file takes. */
const FRAGMENT_FUNCTIONS: Record<string, (html: string) => unknown> = {
  htmlTextContent: (html) => htmlTextContent(html),
  'htmlTextContent:pages': (html) => htmlTextContent(html, PAGE_TEXT),
  proseTextContent: (html) => proseTextContent(html),
  parseInlineHtmlNode: (html) => parseInlineHtmlNode(html),
  htmlToSegmentsNode: (html) => htmlToSegmentsNode(html),
  'richTextToPlainText(htmlToSegmentsNode)': (html) => richTextToPlainText(htmlToSegmentsNode(html)),
  'YBlockSerializer.toRichSegments': (html) => serializer.toRichSegments(html),
  'applyInlineRenderers:raw': (html) => applyInlineRenderers(html, INLINE_RENDERERS),
  'applyInlineRenderers:sanitized': (html) => applyInlineRenderers(sanitizeHtmlFragment(html, INLINE_TEXT_SANITIZE), INLINE_RENDERERS),
  'htmlToBlocksWithReport:title': (html) => htmlToBlocksWithReport(html, { title: true }),
  htmlToBlocksWithReport: (html) => htmlToBlocksWithReport(html),
};

/** What whole pages go through: the importer, and the readers that walk without the sanitizer. */
const PAGE_SUITES = new Set(['htmlToBlocksWithReport', 'htmlToBlocksWithReport:title', 'htmlTextContent', 'proseTextContent', 'htmlToSegmentsNode']);

const asText = (input: unknown): string => (typeof input === 'string' ? input : JSON.stringify(input));

/** All groups. Built lazily: the corpus reads fixtures from disk. */
export const goldenGroups = (): GoldenGroup[] => {
  const sanitizers = Object.entries(sanitizerConfigs()).map(([name, config]) => ({
    name: `sanitizeHtmlFragment.${name}`,
    run: (html: string) => sanitizeHtmlFragment(html, config),
  }));
  const fragmentSuites = [
    ...sanitizers,
    {
      name: 'sanitizeHtmlFragment.inline-text+transform',
      run: (html: string) => sanitizeHtmlFragment(html, INLINE_TEXT_SANITIZE, (url, attr) => (attr === 'src' ? '' : proxyUrl(url))),
    },
    ...Object.entries(FRAGMENT_FUNCTIONS).map(([name, run]) => ({ name, run })),
  ];
  const onText = (suite: { name: string; run: (html: string) => unknown }): GoldenGroup['suites'][number] =>
    ({ name: suite.name, run: (input) => suite.run(asText(input)) });

  return [
    { name: 'fragments', liveInputs: fragmentInputs, suites: fragmentSuites.map(onText) },
    {
      name: 'pages',
      liveInputs: () => realDocuments().map((doc) => doc.html),
      suites: fragmentSuites.filter((suite) => PAGE_SUITES.has(suite.name)).map(onText),
    },
    {
      name: 'documents',
      liveInputs: () => documentInputs(fragmentInputs()),
      suites: Object.entries(DOCUMENT_FUNCTIONS).map(([name, run]) => ({
        name,
        run: (input: unknown) => {
          const { data, shifted } = documentPair(input);

          return run(data, shifted);
        },
      })),
    },
  ];
};
