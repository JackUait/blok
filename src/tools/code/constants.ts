export const TOOL_NAME = 'code';

// i18n keys
export const PLACEHOLDER_KEY = 'tools.code.placeholder';
export const LANGUAGE_KEY = 'tools.code.language';
export const COPIED_KEY = 'tools.code.copied';
export const COPY_CODE_KEY = 'tools.code.copyCode';
export const WRAP_LINES_KEY = 'tools.code.wrapLines';
export const SEARCH_LANGUAGE_KEY = 'tools.code.searchLanguage';

// Default values
export const DEFAULT_LANGUAGE = 'plain text';
export const TAB_STRING = '  '; // 2 spaces

// Language list — display name + lowercase identifier
export interface LanguageEntry {
  id: string;
  name: string;
}

export const LANGUAGES: LanguageEntry[] = [
  { id: 'plain text', name: 'Plain Text' },
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
export const WRAPPER_STYLES = 'flex flex-col rounded-lg bg-bg-secondary overflow-hidden my-1';
export const HEADER_STYLES = 'flex items-center gap-1 px-3 py-1.5 border-b border-border-primary text-xs text-gray-text';
export const LANGUAGE_BUTTON_STYLES = 'px-1.5 py-0.5 rounded cursor-pointer bg-transparent border-0 text-xs text-gray-text font-medium transition-colors can-hover:hover:bg-item-hover-bg select-none';
export const HEADER_BUTTON_STYLES = 'p-1 rounded cursor-pointer bg-transparent border-0 text-gray-text transition-colors can-hover:hover:bg-item-hover-bg flex items-center justify-center';
export const CODE_AREA_STYLES = 'px-4 py-3 font-mono text-sm leading-relaxed outline-hidden whitespace-pre-wrap overflow-x-auto min-h-[1.5em]';
export const COPIED_FEEDBACK_STYLES = 'text-xs text-gray-text font-medium select-none';

// Languages that support preview rendering
export const PREVIEWABLE_LANGUAGES = new Set(['latex', 'mermaid']);

// i18n keys — preview tabs
export const CODE_TAB_KEY = 'tools.code.codeTab';
export const PREVIEW_TAB_KEY = 'tools.code.previewTab';

// CSS — preview tab styles
export const TAB_STYLES = 'px-2 py-0.5 rounded text-xs font-medium cursor-pointer border-0 transition-colors select-none';
export const TAB_ACTIVE_STYLES = 'bg-blue-500 text-white';
export const TAB_INACTIVE_STYLES = 'bg-transparent text-gray-text can-hover:hover:bg-item-hover-bg';
export const PREVIEW_AREA_STYLES = 'px-4 py-3 overflow-x-auto min-h-[1.5em] flex justify-center';

// Shiki theme names for syntax highlighting
export const SHIKI_LIGHT_THEME = 'one-light';
export const SHIKI_DARK_THEME = 'vitesse-dark';

// CSS selector for dark mode (Tailwind convention)
export const DARK_MODE_SELECTOR = '.dark';

// Languages that support syntax highlighting (all except plain text)
export const HIGHLIGHTABLE_LANGUAGES = new Set(
  LANGUAGES
    .map((lang) => lang.id)
    .filter((id) => id !== DEFAULT_LANGUAGE)
);
