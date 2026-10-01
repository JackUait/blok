import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { IconCheck } from '../../components/icons';
import { extToPrismLang } from '../file/code-languages';
import {
  ALL_LANGUAGES_KEY,
  AUTO_DETECTED_KEY,
  DEFAULT_LANGUAGE,
  LANGUAGE_COLORS,
  LANGUAGE_DOT_FALLBACK,
  LANGUAGES,
  SUGGESTED_KEY,
} from './constants';

/** Short marks drawn in each badge. At most three characters, so they fit the tile. */
const LANGUAGE_MARKS: Readonly<Record<string, string>> = {
  'plain text': '¶',
  javascript: 'JS',
  typescript: 'TS',
  python: 'Py',
  java: 'Jv',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rs',
  ruby: 'Rb',
  php: 'php',
  swift: 'Sw',
  kotlin: 'Kt',
  latex: 'TeX',
  mermaid: 'Mm',
  sql: 'SQL',
  html: '<>',
  css: '#',
  json: '{}',
  yaml: 'yml',
  markdown: 'MD',
  bash: '$',
  shell: '>_',
  dockerfile: 'Dk',
  xml: '</>',
  graphql: 'GQ',
  r: 'R',
  scala: 'Sc',
  dart: 'Dt',
  lua: 'Lua',
};

/** Extra search words: short names, extensions and common nicknames. */
const LANGUAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'plain text': ['text', 'txt', 'none', 'plain'],
  javascript: ['js', '.js', 'jsx', 'mjs', 'node', 'ecmascript'],
  typescript: ['ts', '.ts', 'tsx'],
  python: ['py', '.py', 'python3'],
  java: ['.java', 'jvm'],
  c: ['.c', '.h'],
  cpp: ['c++', 'cxx', 'hpp', '.cpp'],
  csharp: ['c#', 'cs', '.cs', 'dotnet', '.net'],
  go: ['golang', '.go'],
  rust: ['rs', '.rs'],
  ruby: ['rb', '.rb'],
  php: ['.php'],
  swift: ['.swift', 'ios'],
  kotlin: ['kt', '.kt', 'kts'],
  latex: ['tex', '.tex', 'math', 'katex'],
  mermaid: ['mmd', 'diagram', 'flowchart', 'chart'],
  sql: ['postgres', 'mysql', 'sqlite', 'query'],
  html: ['htm', '.html', 'markup'],
  css: ['.css', 'scss', 'styles'],
  json: ['.json', 'jsonc'],
  yaml: ['yml', '.yml', '.yaml'],
  markdown: ['md', '.md'],
  bash: ['sh', '.sh', 'zsh'],
  shell: ['sh', 'console', 'terminal', 'cli'],
  dockerfile: ['docker', 'container'],
  xml: ['.xml', 'svg'],
  graphql: ['gql', '.graphql'],
  r: ['.r', 'rlang'],
  scala: ['.scala', 'sbt'],
  dart: ['.dart', 'flutter'],
  lua: ['.lua'],
};

/** Extensions the file tool's map does not cover, because it has no code preview for them. */
const EXTRA_EXTENSIONS: Readonly<Record<string, string>> = {
  md: 'markdown',
  mmd: 'mermaid',
  tex: 'latex',
  xml: 'xml',
  svg: 'xml',
};

export const RECENT_LANGUAGES_STORAGE_KEY = 'blok:code:recent-languages';
const RECENT_LIMIT = 3;
const KNOWN_IDS = new Set(LANGUAGES.map((lang) => lang.id));

/**
 * A small tile with the language's mark, tinted by its color. The name sits
 * next to it, so the tile is decoration only.
 */
export function languageBadge(id: string): HTMLElement {
  const badge = document.createElement('span');

  badge.textContent = LANGUAGE_MARKS[id] ?? id.slice(0, 2);
  badge.style.setProperty('--blok-code-lang', LANGUAGE_COLORS[id] ?? LANGUAGE_DOT_FALLBACK);
  badge.setAttribute('aria-hidden', 'true');
  badge.setAttribute('data-blok-testid', 'code-language-badge');
  badge.className = [
    'inline-flex size-5.5 shrink-0 items-center justify-center rounded-(--blok-radius-control) font-mono text-[9px] font-semibold leading-none tracking-tight',
    'bg-[color-mix(in_srgb,var(--blok-code-lang)_16%,transparent)] text-[color-mix(in_srgb,var(--blok-code-lang)_62%,var(--blok-text-primary))]',
    'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--blok-code-lang)_22%,transparent)]',
  ].join(' ');

  return badge;
}

/** The language a filename implies, from its extension or its whole name. */
export function languageForFilename(filename: string): string | null {
  const base = filename.trim().split(/[\\/]/).pop() ?? '';

  if (base.toLowerCase() === 'dockerfile') {
    return 'dockerfile';
  }

  const dot = base.lastIndexOf('.');

  if (dot <= 0) {
    return null;
  }

  const ext = base.slice(dot + 1).toLowerCase();
  const id = EXTRA_EXTENSIONS[ext] ?? extToPrismLang(ext);

  return id !== null && KNOWN_IDS.has(id) ? id : null;
}

/** Recent picks, newest first. Storage is a per-viewer convenience: any failure reads as empty. */
export function readRecentLanguages(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_LANGUAGES_STORAGE_KEY) ?? '[]');

    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && KNOWN_IDS.has(id)).slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function rememberLanguage(id: string): void {
  if (id === DEFAULT_LANGUAGE || !KNOWN_IDS.has(id)) {
    return;
  }

  const next = [id, ...readRecentLanguages().filter((other) => other !== id)].slice(0, RECENT_LIMIT);

  try {
    localStorage.setItem(RECENT_LANGUAGES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: recents just stay empty */
  }
}

/**
 * A section label row. role="presentation" because the popover's listbox may
 * only own options; search hides Html rows on its own.
 */
function sectionHeader(label: string, isFirst: boolean): PopoverItemParams {
  const element = document.createElement('div');

  element.className = `pl-2 pr-3 ${isFirst ? 'pt-0.5' : 'pt-2.5'} pb-1.5 text-xs font-medium text-menu-section-label cursor-default`;
  element.setAttribute('role', 'presentation');
  element.setAttribute('data-blok-testid', 'code-language-section');
  element.textContent = label;

  return { type: PopoverItemType.Html, element };
}

export interface LanguagePickerOptions {
  selectedId: string;
  detectedId: string | null;
  filename: string;
  recent: readonly string[];
  nameOf: (id: string) => string;
  t: (key: string) => string;
  onPick: (id: string) => void;
}

/**
 * Picker rows: a "Suggested" section (filename language, detected language,
 * recent picks) and then every other language. A suggested language is not
 * repeated below, so search never shows it twice.
 */
export function buildLanguagePickerItems(options: LanguagePickerOptions): PopoverItemParams[] {
  const { selectedId, detectedId, filename, recent, nameOf, t, onPick } = options;
  const suggested = [languageForFilename(filename), detectedId, ...recent]
    .filter((id): id is string => id !== null && id !== selectedId && KNOWN_IDS.has(id))
    .filter((id, index, all) => all.indexOf(id) === index);

  const row = (id: string): PopoverItemParams => ({
    title: nameOf(id),
    name: id,
    icon: languageBadge(id),
    secondaryLabel: id === detectedId && suggested.includes(id) ? t(AUTO_DETECTED_KEY) : undefined,
    trailingIcon: id === selectedId ? IconCheck : undefined,
    // One shared toggle group makes the rows a radio group, so assistive tech hears which is chosen.
    toggle: 'language',
    isActive: id === selectedId,
    searchTerms: [...(LANGUAGE_ALIASES[id] ?? [])],
    closeOnActivate: true,
    onActivate: (): void => onPick(id),
  });

  const rest = LANGUAGES.map((lang) => lang.id).filter((id) => !suggested.includes(id));

  return [
    ...(suggested.length > 0 ? [sectionHeader(t(SUGGESTED_KEY), true), ...suggested.map(row)] : []),
    sectionHeader(t(ALL_LANGUAGES_KEY), suggested.length === 0),
    ...rest.map(row),
  ];
}
