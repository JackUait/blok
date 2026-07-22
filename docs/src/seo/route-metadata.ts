// docs/src/seo/route-metadata.ts
import { API_SECTIONS } from '../components/api/api-data';
import { GROUP_TITLES_EN, MODULE_ORDER, SIDEBAR_GROUPS } from '../components/api/api-nav';
import { TOOL_SECTIONS } from '../components/tools/tools-data';
import { getTranslation, type Locale } from '../i18n';
import { STATIC_PATHS } from '../prerender-paths';
import { BLOK_VERSION } from '../utils/constants';
import {
  DEFAULT_LOCALE,
  LOCALES,
  SITE_URL,
  absoluteUrl,
  localizedPath,
  splitLocalePath,
} from './locales';
import { RU_COPY } from './route-metadata.ru';

// Declared in ./locales, which react-router.config.ts loads without the rest of
// this module; re-exported here because it is part of this module's API.
export { SITE_URL };

/** 1200x630 share card served from docs/public. */
export const OG_IMAGE = `${SITE_URL}/og-default.png`;

export interface BreadcrumbCrumb {
  name: string;
  /** Site-absolute path, mirroring the visible trail's link target. */
  path: string;
}

export interface RouteMetadata {
  title: string;
  description: string;
  /** The page's real H1 copy — the page components read this, not the raw module name. */
  h1: string;
  /** Absolute canonical URL. */
  canonical: string;
  /** Absolute og:image URL. */
  ogImage: string;
  /** Set on routes that must not be indexed (client-side redirects, the 404). */
  noindex?: boolean;
  /** ISO date fed to TechArticle's dateModified; only where the source data carries one. */
  dateModified?: string;
  /** Mirrors the visible breadcrumb trail; absent on top-level routes, which have none. */
  breadcrumbs?: BreadcrumbCrumb[];
}

/** Title / description / H1 copy, keyed by the id the route path is built from. */
export type RouteCopy = Pick<RouteMetadata, 'title' | 'description' | 'h1'>;

type Copy = RouteCopy;

const HOME: Copy = {
  title: 'Blok — Headless Block-Based Rich Text Editor',
  description:
    'Blok is a headless block-based rich text editor for React, Vue, and Angular that stores content as typed JSON instead of HTML.',
  h1: 'Build beautiful block-based editors',
};

const STATIC_COPY: Record<string, Copy> = {
  '/': HOME,
  '/demo': {
    title: 'Blok Playground — Try the Block Editor',
    description:
      'Try Blok in the browser: slash commands, tables, columns, drag and drop, and the JSON it produces.',
    h1: 'Try the Editor',
  },
  '/docs': {
    title: 'Blok Docs — Block Editor for React, Vue & Angular',
    description:
      'Guides, API reference, and 29 built-in block and inline tools for Blok. Start in five minutes.',
    h1: 'Blok documentation',
  },
  '/tools': {
    title: 'Blok Tools Index — Redirect to the Docs',
    description:
      'The old tools index. Every block and inline tool now has its own page under the Blok documentation.',
    h1: 'Blok tools',
  },
  '/migration': {
    title: 'Migrate to Blok — Editor.js, TipTap, Quill',
    description:
      'Migration guides and a codemod for moving an existing editor integration to Blok without rewriting stored content.',
    h1: 'Outgrown Editor.js?',
  },
  '/migration/reference': {
    title: 'Editor.js → Blok Full Migration Reference',
    description:
      'The complete reference: renamed APIs, plugin equivalents, CSS variable mappings, and verification steps.',
    h1: 'Migration reference',
  },
  '/changelog': {
    title: 'Blok Changelog — Release Notes & Versions',
    description: `Every Blok release with its features, fixes, and breaking changes. Currently on ${BLOK_VERSION}.`,
    h1: 'Changelog',
  },
  '/404': {
    title: 'Page Not Found — Blok Documentation',
    description:
      'That URL does not exist on blokeditor.com. Jump back to the homepage or straight into the Blok documentation.',
    h1: 'Page not found',
  },
};

/**
 * Copy for `/docs/<moduleId>`. Descriptions name concrete method and option
 * names on purpose, so a page can be retrieved by a method-name query.
 */
const MODULE_COPY: Record<string, Copy> = {
  'quick-start': {
    title: 'Blok Quick Start — Install & Render an Editor',
    description:
      'Install the package, mount an editor, and save JSON output. Copy-paste setup for JavaScript, React, Vue, and Angular.',
    h1: 'Get started with Blok in five minutes',
  },
  tutorial: {
    title: 'Tutorial — Build a Notion-Style Editor with Blok',
    description:
      'Step by step: mount the editor, register tools, persist blocks, and reload saved content into a fresh instance.',
    h1: 'Build your first Blok editor',
  },
  concepts: {
    title: 'Blok Data Model — Everything Is a Block',
    description:
      'How Blok stores content as nested JSON blocks with parentId and contentIds, and why there is no HTML in the document.',
    h1: "Everything is a block: Blok's data model",
  },
  'custom-block-tool': {
    title: 'Create a Custom Block Tool for Blok',
    description:
      'Implement the BlockTool interface: render, save, validate, toolbox, pasteConfig, and sanitize, with a working example.',
    h1: 'How to create a custom block tool in Blok',
  },
  core: {
    title: 'Blok Class API — new Blok(), isReady, destroy',
    description:
      'Create, await, and tear down an editor instance, and what is safe to call before isReady resolves.',
    h1: 'The Blok class: create and destroy an editor',
  },
  config: {
    title: 'Blok Configuration — holder, tools, data, i18n',
    description:
      'Every configuration option: holder, tools, data, placeholder, readOnly, i18n, and the style tokens.',
    h1: 'Blok configuration options',
  },
  'blocks-api': {
    title: 'Blok Blocks API — insert, move, delete, render',
    description:
      'Insert, move, delete, convert, and render blocks programmatically, including nested blocks and markdown insertion.',
    h1: 'Blocks API: insert, move, delete, and render blocks',
  },
  'block-api': {
    title: 'Blok BlockAPI — id, name, holder, save, dispatch',
    description:
      'Work with a single block: read its id and name, get its holder element, save it, and dispatch tool events.',
    h1: 'BlockAPI: work with a single block',
  },
  'saver-api': {
    title: 'Blok Saver API — save() and OutputData',
    description:
      'Serialize the editor to JSON, what save() returns, and when the promise it hands back resolves.',
    h1: 'Saver API: serialize the editor to JSON',
  },
  'caret-api': {
    title: 'Blok Caret API — setToBlock, focus, position',
    description:
      'Move the caret, focus a block, and read the cursor position without touching the DOM directly.',
    h1: 'Caret API: move, focus, and set cursor position',
  },
  'selection-api': {
    title: 'Blok Selection API — ranges and cross-block',
    description:
      'Read and manipulate the current selection, including selections that span more than one block.',
    h1: 'Selection API: read and set the selection',
  },
  'marks-api': {
    title: 'Blok Marks API — Range-Aware Inline Formatting',
    description:
      'Apply, read, and toggle inline marks across the whole selection with editor.marks — range-aware splitting, in-place updates, and derived sanitizer rules.',
    h1: 'Marks API: range-aware inline formatting',
  },
  'styles-api': {
    title: 'Blok Styles API — CSS class names',
    description:
      'The CSS class names Blok exposes so a custom tool can style itself consistently with the editor.',
    h1: 'Styles API: the class names tools should use',
  },
  'history-api': {
    title: 'Blok History API — undo, redo, transactions',
    description:
      'Undo and redo programmatically, and group several operations into a single undoable transaction.',
    h1: 'History API: undo, redo, and transactions',
  },
  'toolbar-api': {
    title: 'Blok Toolbar API — open, close, toggle',
    description:
      'Open, close, and toggle the block toolbar and its settings menu from your own code.',
    h1: 'Toolbar API: control the block toolbar',
  },
  'inline-toolbar-api': {
    title: 'Blok Inline Toolbar API — open and close',
    description:
      'Show or hide the inline formatting toolbar from your own code, and react to selection changes.',
    h1: 'Inline Toolbar API: control the formatting toolbar',
  },
  'ui-api': {
    title: 'Blok UI API — nodes and editor elements',
    description:
      "Access the editor's DOM nodes: the wrapper, the redactor, and the holder of the current block.",
    h1: "UI API: reach the editor's DOM nodes",
  },
  'notifier-api': {
    title: 'Blok Notifier API — show a notification',
    description:
      'Show success, error, and confirmation notifications from inside a tool or from host code.',
    h1: 'Notifier API: show notifications',
  },
  'tooltip-api': {
    title: 'Blok Tooltip API — show, hide, onHover',
    description:
      "Attach tooltips to your own tool UI using the editor's own tooltip implementation.",
    h1: 'Tooltip API: tooltips for your own tool UI',
  },
  'tools-api': {
    title: 'Blok Tools API — register and update tools',
    description:
      'Register tools, update the toolbox at runtime, and read back which tools are currently available.',
    h1: 'Tools API: register and update tools',
  },
  'events-api': {
    title: 'Blok Events API — on, off, emit',
    description:
      'Subscribe to editor events, emit your own, and the full list of events Blok itself dispatches.',
    h1: 'Events API: subscribe to editor events',
  },
  'listeners-api': {
    title: 'Blok Listeners API — managed DOM listeners',
    description:
      'Attach DOM listeners that Blok removes for you when the editor is destroyed, so a tool cannot leak.',
    h1: 'Listeners API: leak-free DOM listeners',
  },
  'sanitizer-api': {
    title: 'Blok Sanitizer API — clean pasted HTML',
    description:
      "How Blok sanitizes stored and pasted content, and how to declare a tool's own sanitizer config.",
    h1: 'Sanitizer API: how content is cleaned',
  },
  'readonly-api': {
    title: 'Blok Read-Only API — toggle read-only mode',
    description:
      'Toggle read-only mode at runtime, and what a tool must implement for the switch to work in place.',
    h1: 'Read-only API: toggle editing on and off',
  },
  'i18n-api': {
    title: 'Blok i18n API — translate the editor UI',
    description:
      'Supply translations for tool names, toolbar labels, and the accessibility strings Blok renders.',
    h1: "i18n API: translate Blok's interface",
  },
  'output-data': {
    title: 'Blok OutputData — Saved JSON Format Reference',
    description:
      'The exact shape save() returns: time, version, and the blocks array with id, type, data, tunes, parentId, and contentIds.',
    h1: "OutputData: Blok's saved JSON format",
  },
  'block-data': {
    title: 'Blok BlockData — Per-Block Payload Reference',
    description:
      "What lives inside a block's data field, how tunes attach to it, and how parentId and contentIds express nesting.",
    h1: 'BlockData: the per-block payload',
  },
  'blok-editor': {
    title: 'BlokEditor React Component — Props Reference',
    description:
      'Every prop on BlokEditor: data, tools, onChange, onSave, readOnly, onReady, and the imperative ref API.',
    h1: 'The BlokEditor React component',
  },
  'use-blocks': {
    title: 'useBlocks Hook — Blok React API',
    description:
      'Read and mutate blocks from React with useBlocks, including insert, move, and subtree relocation.',
    h1: 'useBlocks(): read and mutate blocks from React',
  },
  'view-api': {
    title: 'Blok View Renderer — Saved JSON to HTML, No Editor',
    description:
      'Render OutputData to sanitized HTML or plain text with blocksToHtml — DOM-free, SSR-safe, no editor instance — plus BlokView and useBlokView for React.',
    h1: 'View renderer: display documents without an editor',
  },
};

/** Copy for `/docs/<toolId>`. One sentence on what it renders, one on its data shape. */
const TOOL_COPY: Record<string, Copy> = {
  paragraph: {
    title: "Paragraph Block — Blok's Default Text Block",
    description:
      'The default text block: inline formatting, markdown shortcuts, colour presets, and the text field it saves.',
    h1: "Paragraph block: Blok's default text block",
  },
  header: {
    title: 'Header Block — Levels, Anchors, Shortcuts',
    description:
      'Headings H1 to H6 with markdown shortcuts, anchor ids, and level conversion from the block settings menu.',
    h1: 'Header block: headings H1 to H6',
  },
  list: {
    title: 'List Block — Ordered, Unordered, Checklist',
    description:
      'Nested ordered, unordered, and checklist items, with Tab and Shift-Tab indentation and lossless list paste.',
    h1: 'List block: ordered, unordered, and checklists',
  },
  table: {
    title: 'Table Block — Merged Cells, Paste from Excel',
    description:
      'Tables with merged cells, per-cell rich content, and lossless paste from Excel, Google Docs, and Notion.',
    h1: 'Table block: merged cells and rich cell content',
  },
  toggle: {
    title: 'Toggle Block — Collapsible Content in Blok',
    description:
      'A collapsible block that owns child blocks through contentIds, including toggle headings that keep their level.',
    h1: 'Toggle block: collapsible content',
  },
  callout: {
    title: 'Callout Block — Highlighted Notes and Tips',
    description:
      'Highlighted note blocks with an icon and a colour preset, for warnings, tips, and asides inside a document.',
    h1: 'Callout block: highlighted notes',
  },
  database: {
    title: 'Database Block — Notion-Style Tables & Views',
    description:
      'A database is a block: its schema and view configs live in data, and every row is a child block of it.',
    h1: 'Database block: schema, views, and rows',
  },
  'database-row': {
    title: 'Database Row Block — Row Property Values',
    description:
      "Each row is a block whose data.properties conforms to the parent database's schema, with child blocks as its page body.",
    h1: 'Database row block: properties and page body',
  },
  divider: {
    title: 'Divider Block — Horizontal Rule in Blok',
    description:
      'A horizontal rule block, the markdown shortcut that creates it, and the empty payload it saves.',
    h1: 'Divider block: a horizontal rule',
  },
  spacer: {
    title: 'Spacer Block — Adjustable Vertical Space',
    description:
      'A resizable vertical space block for controlling page rhythm, and the height it stores in its data.',
    h1: 'Spacer block: adjustable vertical space',
  },
  quote: {
    title: 'Quote Block — Blockquotes with Captions',
    description:
      'Blockquotes with an optional caption and alignment, preserving inline links and formatting on paste.',
    h1: 'Quote block: blockquotes with captions',
  },
  code: {
    title: 'Code Block — Syntax Highlighting & Languages',
    description:
      'Fenced code with syntax highlighting, a language picker, and copy support, plus the code and language it saves.',
    h1: 'Code block: syntax-highlighted code',
  },
  image: {
    title: 'Image Block — Upload, Paste, Resize, Compress',
    description:
      'Upload, paste, or link images, with resizing, captions, client-side compression, and an enforced size limit.',
    h1: 'Image block: uploads, captions, and resizing',
  },
  column_list: {
    title: 'Columns Block — Multi-Column Page Layout',
    description:
      'A row of resizable columns, where each column is itself a block that owns its own children.',
    h1: 'Columns block: multi-column layout',
  },
  column: {
    title: 'Column Block — A Single Layout Column',
    description:
      'A single column inside a column list, carrying a width fraction and its own list of child blocks.',
    h1: 'Column block: one column of a layout',
  },
  embed: {
    title: 'Embed Block — 115 Supported Services',
    description:
      'Paste a URL from a supported service and get a responsive embed, with a resizable height and a service registry.',
    h1: 'Embed block: responsive third-party embeds',
  },
  bookmark: {
    title: 'Bookmark Block — Rich Link Previews',
    description:
      'Turn a URL into a rich link card with a title, description, and favicon, degrading gracefully when metadata is missing.',
    h1: 'Bookmark block: rich link previews',
  },
  file: {
    title: 'File Block — Attachments and Downloads',
    description:
      'Attach arbitrary files with a download affordance, a file name, and size metadata stored on the block.',
    h1: 'File block: attachments and downloads',
  },
  audio: {
    title: 'Audio Block — Embedded Audio Player',
    description:
      'Upload or link audio and render an inline player, including share links from the common hosting services.',
    h1: 'Audio block: an inline audio player',
  },
  video: {
    title: 'Video Block — Uploads and Embedded Players',
    description:
      'Upload video or embed a player, with automatic GIF to WebM conversion and a generous upload size limit.',
    h1: 'Video block: uploads and embedded players',
  },
  bold: {
    title: 'Bold Inline Tool — Strong Emphasis in Blok',
    description:
      'Make a selection bold from the inline toolbar or with Cmd/Ctrl+B, and the markup it writes into block text.',
    h1: 'Bold: strong emphasis in Blok',
  },
  italic: {
    title: 'Italic Inline Tool — Emphasised Text',
    description:
      'Italicise a selection from the inline toolbar or with Cmd/Ctrl+I, and the markup it writes into block text.',
    h1: 'Italic: emphasised text in Blok',
  },
  link: {
    title: 'Link Tool — Blok Inline Link Editing',
    description:
      'Insert and edit links, control target behaviour, and configure the hover card and the link edit menu.',
    h1: 'Link tool: insert and edit inline links',
  },
  marker: {
    title: 'Marker Inline Tool — Highlight Text',
    description:
      'Highlight a selection with the marker tool, pick a colour, and see the markup it stores in the block.',
    h1: 'Marker: highlight text with colour',
  },
  underline: {
    title: 'Underline Inline Tool — Cmd+U in Blok',
    description:
      'Underline a selection from the inline toolbar or with Cmd/Ctrl+U, and the markup it stores in block text.',
    h1: 'Underline: underlined text in Blok',
  },
  strikethrough: {
    title: 'Strikethrough Inline Tool — Crossed-Out Text',
    description:
      "Strike through a selection from the inline toolbar, and the markup Blok stores inside the block's text field.",
    h1: 'Strikethrough: crossed-out text in Blok',
  },
  inlineCode: {
    title: 'Inline Code Tool — Monospace Code Spans',
    description:
      "Mark a selection as inline code with Cmd/Ctrl+E, and the markup it stores inside a block's text field.",
    h1: 'Inline code: monospace code spans',
  },
  equation: {
    title: 'Equation Tool — Inline LaTeX Math in Blok',
    description:
      'Write inline math with LaTeX syntax, and how equations are stored and sanitized inside a block.',
    h1: 'Equation tool: inline LaTeX math',
  },
  clearFormat: {
    title: 'Clear Format Tool — Strip Inline Styling',
    description:
      'Remove every inline mark from a selection in one action, leaving plain text without touching block structure.',
    h1: 'Clear format: strip inline styling',
  },
};

const TOOL_GROUP_TITLES: Record<'block' | 'inline', string> = {
  block: 'Block Tools',
  inline: 'Inline Tools',
};

/**
 * Copy for one locale, keyed by the unprefixed route path. The English tables
 * above are keyed by id for readability; this flattens them onto the same key
 * space the Russian table uses. Modules win over tools on a shared id, matching
 * the loop order the map was built with before.
 */
const byPath = (copy: Record<string, Copy>): Record<string, Copy> =>
  Object.fromEntries(Object.entries(copy).map(([id, value]) => [`/docs/${id}`, value]));

const COPY_BY_LOCALE: Record<Locale, Record<string, Copy>> = {
  en: { ...STATIC_COPY, ...byPath(TOOL_COPY), ...byPath(MODULE_COPY) },
  ru: RU_COPY,
};

const canonicalFor = (path: string, locale: Locale): string =>
  absoluteUrl(localizedPath(path, locale));

/** The two fixed crumbs; every other crumb name comes from the copy tables. */
const BREADCRUMB_ROOTS: Record<Locale, { home: string; docs: string }> = {
  en: { home: 'Home', docs: 'Docs' },
  ru: { home: 'Главная', docs: 'Документация' },
};

const groupTitle = (locale: Locale, key: string): string =>
  locale === DEFAULT_LOCALE ? GROUP_TITLES_EN[key] : getTranslation(locale, `api.sections.${key}`);

const toolGroupTitle = (locale: Locale, type: 'block' | 'inline'): string =>
  locale === DEFAULT_LOCALE
    ? TOOL_GROUP_TITLES[type]
    : getTranslation(locale, `tools.sections.${type === 'block' ? 'blockTools' : 'inlineTools'}`);

/**
 * Mirrors the visible trail rendered by Breadcrumbs.tsx: Docs / <group> / <page>,
 * prefixed with Home so the markup starts at the site root as Google expects.
 * The group crumb points at the group's first page, which is where the visible
 * crumb links too. Every path stays inside the trail's own locale tree.
 */
const docsBreadcrumbs = (
  locale: Locale,
  crumbGroupTitle: string,
  groupFirstPath: string,
  path: string,
  h1: string,
): BreadcrumbCrumb[] => [
  { name: BREADCRUMB_ROOTS[locale].home, path: localizedPath('/', locale) },
  { name: BREADCRUMB_ROOTS[locale].docs, path: localizedPath('/docs', locale) },
  { name: crumbGroupTitle, path: localizedPath(groupFirstPath, locale) },
  { name: h1, path: localizedPath(path, locale) },
];

/**
 * `dateModified` for the reference pages comes from the `lastUpdated` field
 * ApiSection already renders, so the structured data cannot drift away from the
 * date a reader sees on the page.
 */
const lastUpdatedById = new Map(
  API_SECTIONS.filter((section) => section.lastUpdated).map((section) => [
    section.id,
    section.lastUpdated as string,
  ]),
);

const buildRouteMetadata = (locale: Locale): Record<string, RouteMetadata> => {
  const copyTable = COPY_BY_LOCALE[locale];
  const map: Record<string, RouteMetadata> = {};

  for (const path of STATIC_PATHS) {
    const copy = copyTable[path];
    if (!copy) continue;
    const noindex = path === '/tools' || path === '/404';
    map[path] = {
      ...copy,
      // A client-side redirect and the error page must not compete for the
      // destinations they point at, so both consolidate onto those.
      canonical: canonicalFor(path === '/tools' ? '/docs/paragraph' : path, locale),
      ogImage: OG_IMAGE,
      ...(noindex && { noindex: true }),
    };
  }

  const groupOf = new Map<string, { key: string; firstId: string }>();
  for (const group of SIDEBAR_GROUPS) {
    for (const id of group.moduleIds) {
      groupOf.set(id, { key: group.key, firstId: group.moduleIds[0] });
    }
  }

  for (const id of MODULE_ORDER) {
    const path = `/docs/${id}`;
    const copy = copyTable[path];
    if (!copy) continue;
    const group = groupOf.get(id);
    map[path] = {
      ...copy,
      canonical: canonicalFor(path, locale),
      ogImage: OG_IMAGE,
      ...(lastUpdatedById.has(id) && { dateModified: lastUpdatedById.get(id) }),
      ...(group && {
        breadcrumbs: docsBreadcrumbs(
          locale,
          groupTitle(locale, group.key),
          `/docs/${group.firstId}`,
          path,
          copy.h1,
        ),
      }),
    };
  }

  // tools-data.ts carries a duplicate id; first occurrence wins, matching the
  // sidebar's own dedupe.
  const firstToolOfType: Partial<Record<'block' | 'inline', string>> = {};
  for (const tool of TOOL_SECTIONS) {
    firstToolOfType[tool.type] ??= tool.id;
  }

  for (const tool of TOOL_SECTIONS) {
    const path = `/docs/${tool.id}`;
    if (map[path]) continue;
    const copy = copyTable[path];
    if (!copy) continue;
    map[path] = {
      ...copy,
      canonical: canonicalFor(path, locale),
      ogImage: OG_IMAGE,
      breadcrumbs: docsBreadcrumbs(
        locale,
        toolGroupTitle(locale, tool.type),
        `/docs/${firstToolOfType[tool.type]}`,
        path,
        copy.h1,
      ),
    };
  }

  return map;
};

/**
 * Every addressable route of one locale tree, keyed by its *unprefixed* path.
 * `canonical` and the breadcrumb paths are already prefixed, so a consumer never
 * has to re-derive the locale from the key.
 */
const METADATA_BY_LOCALE = Object.fromEntries(
  LOCALES.map((locale) => [locale, buildRouteMetadata(locale)]),
) as Record<Locale, Record<string, RouteMetadata>>;

/** The English tree, keyed by its site-absolute path. */
export const ROUTE_METADATA: Record<string, RouteMetadata> = METADATA_BY_LOCALE.en;

/** The Russian tree, keyed by the same unprefixed paths as the English one. */
export const RU_ROUTE_METADATA: Record<string, RouteMetadata> = METADATA_BY_LOCALE.ru;

/**
 * Look up a route's metadata from a real request path, tolerating a trailing
 * slash and a locale prefix (`/ru/docs/table` resolves to the Russian entry).
 */
export const getRouteMetadata = (pathname: string): RouteMetadata | undefined => {
  const { locale, path } = splitLocalePath(pathname);
  return METADATA_BY_LOCALE[locale][path];
};
