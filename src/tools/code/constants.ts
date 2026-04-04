export const TOOL_NAME = 'code';

// i18n keys
export const PLACEHOLDER_KEY = 'tools.code.placeholder';
export const LANGUAGE_KEY = 'tools.code.language';
export const COPIED_KEY = 'tools.code.copied';
export const COPY_CODE_KEY = 'tools.code.copyCode';
export const WRAP_LINES_KEY = 'tools.code.wrapLines';

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
