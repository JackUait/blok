/**
 * Maps a (lower-cased) file extension to a Prism language id understood by
 * `tokenizePrism`. Returns null when the extension has no code mapping.
 * Markdown is intentionally absent here — it is handled by the 'markdown'
 * preview kind, not the 'code' kind.
 */
const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  sql: 'sql',
  html: 'html', htm: 'html',
  css: 'css',
  scss: 'css',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  sh: 'bash', bash: 'bash',
  graphql: 'graphql', gql: 'graphql',
  lua: 'lua',
  dart: 'dart',
  r: 'r',
  scala: 'scala',
};

export function extToPrismLang(ext: string): string | null {
  return EXT_TO_LANG[ext.toLowerCase()] ?? null;
}
