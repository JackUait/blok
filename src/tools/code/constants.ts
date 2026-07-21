export const TOOL_NAME = 'code';

// i18n keys
export const PLACEHOLDER_KEY = 'tools.code.placeholder';
export const LANGUAGE_KEY = 'tools.code.language';
export const COPIED_KEY = 'tools.code.copied';
export const COPY_CODE_KEY = 'tools.code.copyCode';
export const SEARCH_LANGUAGE_KEY = 'tools.code.searchLanguage';
export const AUTO_DETECTED_KEY = 'tools.code.autoDetected';
export const PLAIN_TEXT_KEY = 'tools.code.plainText';

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

// CSS — Tailwind classes
export const WRAPPER_STYLES = 'group/code flex flex-col rounded-xl border border-border-secondary bg-bg-secondary overflow-hidden my-2';
export const HEADER_STYLES = 'flex items-center gap-1 px-3 py-1.5 text-xs text-gray-text';
export const LANGUAGE_BUTTON_STYLES = 'inline-flex items-center px-1.5 py-0.5 rounded cursor-pointer bg-transparent border-0 text-xs text-gray-text font-medium transition-colors can-hover:hover:bg-item-hover-bg select-none';
export const HEADER_CONTROLS_STYLES = 'flex items-center gap-1 opacity-0 group-hover/code:opacity-100 transition-opacity';
export const HEADER_BUTTON_STYLES = 'p-1 rounded cursor-pointer bg-transparent border-0 text-gray-text transition-colors can-hover:hover:bg-item-hover-bg flex items-center justify-center';
export const HEADER_BUTTON_MATCHED_STYLES = 'p-1.5 rounded-lg cursor-pointer bg-transparent border-0 text-gray-text transition-colors can-hover:hover:bg-item-hover-bg flex items-center justify-center';
export const CODE_AREA_STYLES = 'block px-4 py-3 font-mono text-sm leading-relaxed outline-hidden whitespace-pre-wrap overflow-x-auto min-h-[1.5em] caret-text-primary';
export const COPIED_FEEDBACK_STYLES = 'text-xs text-gray-text font-medium select-none';

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
export const VIEW_MODE_CONTAINER_STYLES = 'flex items-center rounded-lg border border-border-secondary p-0.5 gap-0.5';
export const VIEW_MODE_BUTTON_STYLES = 'p-1 rounded cursor-pointer bg-transparent border-0 text-gray-text transition-colors flex items-center justify-center';
export const VIEW_MODE_BUTTON_ACTIVE_STYLES = 'p-1 rounded cursor-pointer bg-item-hover-bg border-0 text-text-primary transition-colors flex items-center justify-center';

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
export const CODE_BODY_STYLES = 'flex overflow-hidden';
export const GUTTER_STYLES = 'select-none text-right pl-4 pr-3 py-3 font-mono text-sm leading-relaxed text-gray-text/40 shrink-0';
export const GUTTER_LINE_STYLES = 'leading-relaxed cursor-text';
