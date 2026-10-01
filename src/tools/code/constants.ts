import { CODE_AREA_CLASSES, CODE_WRAPPER_CLASSES } from '../../shared/tool-classes/code';

export const TOOL_NAME = 'code';

// i18n keys
export const PLACEHOLDER_KEY = 'tools.code.placeholder';
export const LANGUAGE_KEY = 'tools.code.language';
export const COPIED_KEY = 'tools.code.copied';
export const COPY_CODE_KEY = 'tools.code.copyCode';
export const SEARCH_LANGUAGE_KEY = 'tools.code.searchLanguage';
export const AUTO_DETECTED_KEY = 'tools.code.autoDetected';
export const PLAIN_TEXT_KEY = 'tools.code.plainText';
export const FILENAME_KEY = 'tools.code.filename';
export const SUGGESTED_KEY = 'tools.code.suggested';

// Default values
export const DEFAULT_LANGUAGE = 'plain text';
export const TAB_STRING = '  '; // 2 spaces

// Language list — display name + lowercase identifier
export interface LanguageEntry {
  id: string;
  name: string;
}

export const LANGUAGES: LanguageEntry[] = [
  { id: 'plain text', name: 'Plain text' },
  { id: 'javascript', name: 'JavaScript' },
  { id: 'typescript', name: 'TypeScript' },
  { id: 'python', name: 'Python' },
  { id: 'java', name: 'Java' },
  { id: 'c', name: 'C' },
  { id: 'cpp', name: 'C++' },
  { id: 'csharp', name: 'C#' },
  { id: 'go', name: 'Go' },
  { id: 'rust', name: 'Rust' },
  { id: 'ruby', name: 'Ruby' },
  { id: 'php', name: 'PHP' },
  { id: 'swift', name: 'Swift' },
  { id: 'kotlin', name: 'Kotlin' },
  { id: 'latex', name: 'LaTeX' },
  { id: 'mermaid', name: 'Mermaid' },
  { id: 'sql', name: 'SQL' },
  { id: 'html', name: 'HTML' },
  { id: 'css', name: 'CSS' },
  { id: 'json', name: 'JSON' },
  { id: 'yaml', name: 'YAML' },
  { id: 'markdown', name: 'Markdown' },
  { id: 'bash', name: 'Bash' },
  { id: 'shell', name: 'Shell' },
  { id: 'dockerfile', name: 'Dockerfile' },
  { id: 'xml', name: 'XML' },
  { id: 'graphql', name: 'GraphQL' },
  { id: 'r', name: 'R' },
  { id: 'scala', name: 'Scala' },
  { id: 'dart', name: 'Dart' },
  { id: 'lua', name: 'Lua' },
];

/** Language dots use each language's GitHub Linguist color; a dot is a swatch, not a selected state. */
export const LANGUAGE_COLORS: Readonly<Record<string, string>> = {
  javascript: '#f1e05a',
  typescript: '#3178c6',
  python: '#3572a5',
  java: '#b07219',
  c: '#555555',
  cpp: '#f34b7d',
  csharp: '#178600',
  go: '#00add8',
  rust: '#dea584',
  ruby: '#701516',
  php: '#4f5d95',
  swift: '#f05138',
  kotlin: '#a97bff',
  latex: '#3d6117',
  mermaid: '#ff3670',
  sql: '#e38c00',
  html: '#e34c26',
  css: '#663399',
  json: '#cbcb41',
  yaml: '#cb171e',
  markdown: '#083fa1',
  bash: '#89e051',
  shell: '#89e051',
  dockerfile: '#384d54',
  xml: '#0060ac',
  graphql: '#e10098',
  r: '#198ce7',
  scala: '#c22d40',
  dart: '#00b4ab',
  lua: '#000080',
};
export const LANGUAGE_DOT_FALLBACK = 'var(--blok-gray-text)';

// CSS — Tailwind classes
/**
 * Static presentational classes live in `src/shared/tool-classes/code.ts` so the
 * view emitter stamps the exact same set. `group/code` stays here: it paints
 * nothing, existing only to enable the `group-hover/code:` rules on the header
 * controls below, which a static view never renders.
 */
export const WRAPPER_STYLES = ['group/code', '@container/code', ...CODE_WRAPPER_CLASSES].join(' ');
/** Below this block width the Copy button keeps only its icon, so the header never clips. */
export const COPY_LABEL_STYLES = 'hidden @min-[26rem]/code:inline';
/**
 * Publishes the corner radius for the header controls: the card's block
 * radius minus its 1px border and this row's `py-1.5`.
 */
export const HEADER_STYLES = ['flex items-center gap-1 min-h-10 px-2 py-1.5 border-b border-border-secondary bg-bg-secondary text-xs text-gray-text', '[--blok-radius-inner:max(var(--blok-radius-floor),calc(var(--blok-radius-block)-var(--blok-border-width-hairline)-var(--blok-space-1-5)))]'].join(' ');
export const LANGUAGE_BUTTON_STYLES = 'inline-flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 rounded-(--blok-radius-inner,var(--blok-radius-control)) cursor-pointer bg-transparent border-0 text-xs text-gray-text font-medium transition-colors can-hover:hover:bg-item-hover-bg select-none';
/** Read-only has no picker to open — the language label is plain, unfocusable text there. */
export const LANGUAGE_LABEL_STYLES = 'inline-flex min-w-0 items-center gap-1.5 px-1.5 py-0.5 bg-transparent border-0 text-xs text-gray-text font-medium';
export const LANGUAGE_DOT_STYLES = 'size-2 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]';
/** Placeholder only shows while the block is hovered or focused, so filename-less blocks stay quiet. */
const FILENAME_TEXT_STYLES = 'min-w-0 truncate font-mono text-xs text-text-primary';
export const FILENAME_BUTTON_STYLES = [
  FILENAME_TEXT_STYLES,
  'flex-1 text-left px-1.5 py-0.5 select-none rounded-(--blok-radius-inner,var(--blok-radius-control)) cursor-text bg-transparent border-0 transition-colors can-hover:hover:bg-item-hover-bg',
  'data-[empty=true]:text-gray-text data-[empty=true]:font-sans data-[empty=true]:opacity-0 group-hover/code:data-[empty=true]:opacity-100 group-focus-within/code:data-[empty=true]:opacity-100 focus-visible:opacity-100',
].join(' ');
export const FILENAME_LABEL_STYLES = [FILENAME_TEXT_STYLES, 'flex-1 px-1.5 py-0.5'].join(' ');
export const FILENAME_INPUT_STYLES = [
  FILENAME_TEXT_STYLES,
  'flex-1 px-1.5 py-0.5 rounded-(--blok-radius-inner,var(--blok-radius-control)) bg-item-hover-bg border-0 outline-hidden placeholder:text-gray-text placeholder:font-sans',
].join(' ');
export const HEADER_CONTROLS_STYLES = 'flex shrink-0 items-center gap-1 opacity-0 group-hover/code:opacity-100 group-focus-within/code:opacity-100 transition-opacity';
/**
 * `h-*`/`min-w-*` pin the box: the copy button swaps its 20px icon for a
 * text-xs "Copied!" label, which would otherwise shrink it below the height of
 * its own icon state and of the neighbouring view-mode buttons.
 */
export const HEADER_BUTTON_STYLES = 'select-none gap-1 px-1.5 h-7 min-w-7 text-xs font-medium rounded-(--blok-radius-inner,var(--blok-radius-control)) cursor-pointer bg-transparent border-0 text-gray-text transition-colors can-hover:hover:bg-item-hover-bg flex items-center justify-center';
export const HEADER_BUTTON_MATCHED_STYLES = 'select-none gap-1 px-2 h-8.5 min-w-8.5 text-xs font-medium rounded-(--blok-radius-inner,var(--blok-radius-control)) cursor-pointer bg-transparent border-0 text-gray-text transition-colors can-hover:hover:bg-item-hover-bg flex items-center justify-center';
/**
 * Static classes live in `src/shared/tool-classes/code.ts`. `outline-hidden` and
 * `caret-text-primary` stay here — a static render has no focus ring and no
 * caret.
 */
export const CODE_AREA_STYLES = [...CODE_AREA_CLASSES, 'outline-hidden', 'caret-text-primary'].join(' ');

// Languages that support preview rendering
export const PREVIEWABLE_LANGUAGES = new Set(['latex', 'mermaid']);

// i18n keys — preview tabs
export const CODE_TAB_KEY = 'tools.code.codeTab';
export const PREVIEW_TAB_KEY = 'tools.code.previewTab';

// CSS — preview tab styles
export const PREVIEW_AREA_STYLES = 'px-4 py-3 overflow-x-auto min-h-[1.5em] flex justify-center';

// i18n key — side-by-side view mode
export const SIDE_BY_SIDE_KEY = 'tools.code.sideBySide';

// View mode type
export type CodeViewMode = 'code' | 'preview' | 'split';

// CSS — view mode segmented control
/** Publishes its own inner radius: large-control radius minus 1px border and `p-0.5`. */
export const VIEW_MODE_CONTAINER_STYLES = 'flex items-center rounded-(--blok-radius-control-lg) border border-border-secondary p-0.5 gap-0.5 [--blok-radius-inner:max(var(--blok-radius-floor),calc(var(--blok-radius-control-lg)-var(--blok-border-width-hairline)-var(--blok-space-0-5)))]';
export const VIEW_MODE_BUTTON_STYLES = 'p-1 rounded-(--blok-radius-inner,var(--blok-radius-control)) cursor-pointer bg-transparent border-0 text-gray-text transition-colors flex items-center justify-center';
export const VIEW_MODE_BUTTON_ACTIVE_STYLES = 'p-1 rounded-(--blok-radius-inner,var(--blok-radius-control)) cursor-pointer bg-item-hover-bg border-0 text-text-primary transition-colors flex items-center justify-center';

// CSS — split container
export const SPLIT_CONTAINER_STYLES = 'flex flex-col overflow-hidden';
export const SPLIT_CONTAINER_SPLIT_STYLES = 'flex flex-row overflow-hidden';
export const SPLIT_HALF_STYLES = 'flex-1 min-w-0 overflow-hidden';

// Languages that support syntax highlighting (all except plain text)
export const HIGHLIGHTABLE_LANGUAGES = new Set(
  LANGUAGES
    .map((lang) => lang.id)
    .filter((id) => id !== DEFAULT_LANGUAGE)
);

// CSS — line number gutter
export const CODE_BODY_STYLES = 'relative flex overflow-hidden';
/** Sits behind the gutter and code (both `relative`, so they paint above it). */
export const ACTIVE_LINE_STYLES = 'absolute inset-x-0 top-0 pointer-events-none bg-[color-mix(in_srgb,var(--blok-item-hover-bg)_55%,transparent)] transition-[transform,height] duration-75 ease-out motion-reduce:transition-none';
/**
 * The line-number gutter. Its type scale MUST track the code area's — the two
 * columns are separate elements whose lines only align while their font size
 * and line height match — so it reads the same host hook
 * (`config.style.fontSize.code`) with the same `text-sm` fallback.
 */
export const GUTTER_STYLES = 'relative select-none text-right pl-4 pr-3 py-3 font-mono text-[length:var(--blok-code-font-size,0.875rem)] leading-relaxed text-gray-text/70 tabular-nums shrink-0';
export const GUTTER_LINE_STYLES = 'leading-relaxed cursor-text transition-colors data-[active=true]:text-text-primary';
