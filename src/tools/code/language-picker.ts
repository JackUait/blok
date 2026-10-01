import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { IconCheck } from '../../components/icons';
import { extToPrismLang } from '../file/code-languages';
import type { LanguageLogo } from './language-logos';
import type { DrawnLogo } from './language-logos-own';

export type AnyLogo = LanguageLogo | DrawnLogo;
type LogoMap = Readonly<Record<string, AnyLogo>>;
import {
  AUTO_DETECTED_KEY,
  DEFAULT_LANGUAGE,
  LANGUAGE_COLORS,
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

export type PickerTheme = 'light' | 'dark';

/** The popover surface each theme paints (`--blok-popover-bg` in colors.css). */
const MENU_BG: Readonly<Record<PickerTheme, string>> = { light: '#ffffff', dark: '#252525' };

/** WCAG 1.4.11: a graphic needs 3:1 against what is behind it. */
const GRAPHIC_CONTRAST = 3;

const channel = (hex: string, at: number): number => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

/** `hex` mixed toward `toward` by `share` (0..1). */
const mix = (hex: string, toward: string, share: number): string =>
  `#${[1, 3, 5].map((at) => Math.round(parseInt(hex.slice(at, at + 2), 16) * (1 - share) + parseInt(toward.slice(at, at + 2), 16) * share).toString(16).padStart(2, '0')).join('')}`;

/**
 * The brand color, shifted only as far as it must to reach 3:1 on the menu:
 * toward black on light, toward white on dark.
 */
const legibleOn = (hex: string, theme: PickerTheme, share = 0): string => {
  // A black mark (Rust, JSON, Markdown…) is shown near-white on dark, as its brand does.
  if (share === 0 && theme === 'dark' && luminance(hex) < 0.03) {
    return mix(hex, '#ffffff', 0.85);
  }

  const color = share === 0 ? hex : mix(hex, theme === 'dark' ? '#ffffff' : '#000000', share);

  return contrast(color, MENU_BG[theme]) >= GRAPHIC_CONTRAST || share >= 0.9 ? color : legibleOn(hex, theme, share + 0.05);
};

/** Same rule Blok's ThemeManager follows: the attribute wins, else the OS. */
export function resolvePickerTheme(): PickerTheme {
  const attr = document.documentElement.getAttribute('data-blok-theme');

  if (attr === 'dark' || attr === 'light') {
    return attr;
  }

  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Logos load on first use; the picker shows mono marks until they arrive. */
const logosState: {
  promise: Promise<LogoMap> | null;
  loaded: LogoMap | null;
} = { promise: null, loaded: null };

export function loadLanguageLogos(): Promise<LogoMap> {
  logosState.promise ??= Promise.all([import('./language-logos'), import('./language-logos-own')]).then(([vendored, own]) => {
    const logos: LogoMap = { ...vendored.LANGUAGE_LOGOS, ...own.OWN_LANGUAGE_LOGOS };

    logosState.loaded = logos;

    return logos;
  });

  return logosState.promise;
}

/** The logos if they have already loaded, else null. */
export function loadedLanguageLogos(): LogoMap | null {
  return logosState.loaded;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Mask ids are document-global, so every drawn badge needs its own. */
const maskCounter = { next: 0 };

/**
 * A drawn logo: `body` clipped by a mask where `cuts` are holes, then `over`.
 * The markup is Blok's own constant artwork, never user data.
 */
const drawnSvg = (svg: SVGSVGElement, logo: DrawnLogo): SVGSVGElement => {
  const maskId = `blok-code-logo-${maskCounter.next++}`;
  const masked = logo.cuts === undefined
    ? logo.body
    : `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>${logo.cuts}</mask></defs><g mask="url(#${maskId})">${logo.body}</g>`;

  svg.insertAdjacentHTML('beforeend', masked + (logo.over ?? ''));

  return svg;
};

const logoSvg = (logo: AnyLogo): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg');

  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');

  if ('body' in logo) {
    return drawnSvg(svg, logo);
  }

  if (logo.inner !== undefined) {
    // Sits inside the square, under the cut-out letters.
    const backing = document.createElementNS(SVG_NS, 'rect');

    backing.setAttribute('x', '2');
    backing.setAttribute('y', '2');
    backing.setAttribute('width', '20');
    backing.setAttribute('height', '20');
    backing.setAttribute('fill', logo.inner);
    svg.appendChild(backing);
  }

  const path = document.createElementNS(SVG_NS, 'path');

  path.setAttribute('d', logo.path);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);

  return svg;
};

const BADGE_STYLES = [
  'inline-flex size-5 shrink-0 items-center justify-center select-none',
  'motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out',
  'motion-safe:in-[[data-blok-popover-item]:hover]:scale-110 motion-safe:in-[[data-blok-focused=true]]:scale-110',
].join(' ');

/** Laid out like the TS logo: a square with bold letters in its bottom-right corner. */
const MONOGRAM_STYLES = 'inline-flex size-[18px] items-end justify-end rounded-(--blok-radius-mark) pr-[1.5px] pb-px font-sans text-[8.5px] font-bold leading-none tracking-[-0.02em]';

const AA = 4.5;

/**
 * Square and letter colors for a monogram: white or near-black ink, whichever
 * reads; a mid-tone that clears AA with neither is deepened until white does.
 */
const monogramColors = (hex: string, share = 0): { square: string; ink: string } => {
  const square = share === 0 ? hex : mix(hex, '#000000', share);
  const onWhite = contrast(square, '#ffffff');
  const onInk = contrast(square, '#1b1a17');

  if (Math.max(onWhite, onInk) >= AA || share >= 0.6) {
    return { square, ink: onWhite >= onInk ? '#ffffff' : '#1b1a17' };
  }

  return monogramColors(hex, share + 0.04);
};

const monogram = (mark: string, hex: string): HTMLElement => {
  const square = document.createElement('span');
  const { square: fill, ink } = monogramColors(hex);

  square.setAttribute('data-monogram', '');
  square.className = MONOGRAM_STYLES;
  square.style.setProperty('background-color', fill);
  square.style.setProperty('color', ink);
  square.textContent = mark;

  return square;
};

export interface BadgeOptions {
  theme: PickerTheme;
  /** null while the logos module is still loading. */
  logos: LogoMap | null;
}

/** Fill `badge` for `id`: the real logo when one is vendored, else a mono mark. */
export function paintBadge(badge: HTMLElement, id: string, { theme, logos }: BadgeOptions): void {
  const logo = logos?.[id];
  const brand = logo?.hex ?? LANGUAGE_COLORS[id];

  const mark = LANGUAGE_MARKS[id] ?? id.slice(0, 2);

  if (brand === undefined) {
    badge.setAttribute('data-neutral', 'true');
    badge.setAttribute('class', `${BADGE_STYLES} text-[13px] text-text-secondary`);
    badge.style.removeProperty('color');
    badge.replaceChildren(mark);

    return;
  }

  badge.setAttribute('class', BADGE_STYLES);

  if (logo === undefined) {
    badge.style.removeProperty('color');
    badge.replaceChildren(monogram(mark, brand));

    return;
  }

  // A square mark with filled letter holes carries its own contrast.
  badge.style.setProperty('color', 'inner' in logo && logo.inner !== undefined ? brand : legibleOn(brand, theme));
  badge.replaceChildren(logoSvg(logo));
}

/** Repaint every badge under `root`, e.g. once the logos arrive while the picker is open. */
export function repaintBadges(root: HTMLElement, options: BadgeOptions): void {
  root.querySelectorAll<HTMLElement>('[data-blok-testid="code-language-badge"]').forEach((badge) => {
    paintBadge(badge, badge.getAttribute('data-language') ?? '', options);
  });
}

/** A language's mark for a picker row. The name sits next to it, so it is decoration only. */
export function languageBadge(id: string, options: BadgeOptions): HTMLElement {
  const badge = document.createElement('span');

  badge.setAttribute('aria-hidden', 'true');
  badge.setAttribute('data-blok-testid', 'code-language-badge');
  badge.setAttribute('data-language', id);
  paintBadge(badge, id, options);

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
function sectionHeader(label: string): PopoverItemParams {
  const element = document.createElement('div');

  element.className = 'pl-2 pr-3 pt-0.5 pb-1.5 text-xs font-medium text-menu-section-label cursor-default';
  element.setAttribute('role', 'presentation');
  element.setAttribute('data-blok-testid', 'code-language-section');
  element.textContent = label;

  return { type: PopoverItemType.Html, element };
}

/** The line between the suggestions and the full list. role="presentation" for the same listbox reason. */
function sectionDivider(): PopoverItemParams {
  const element = document.createElement('div');
  const line = document.createElement('div');

  element.className = 'py-1.5';
  element.setAttribute('role', 'presentation');
  element.setAttribute('data-blok-testid', 'code-language-divider');
  line.className = 'h-px -mx-1 bg-popover-border/60';
  line.setAttribute('aria-hidden', 'true');
  element.appendChild(line);

  return { type: PopoverItemType.Html, element };
}

export interface LanguagePickerOptions extends BadgeOptions {
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
 * recent picks), a divider, and then every other language, unlabelled. A suggested language is not
 * repeated below, so search never shows it twice.
 */
export function buildLanguagePickerItems(options: LanguagePickerOptions): PopoverItemParams[] {
  const { selectedId, detectedId, filename, recent, nameOf, t, onPick, theme, logos } = options;
  const suggested = [languageForFilename(filename), detectedId, ...recent]
    .filter((id): id is string => id !== null && id !== selectedId && KNOWN_IDS.has(id))
    .filter((id, index, all) => all.indexOf(id) === index);

  const row = (id: string): PopoverItemParams => ({
    title: nameOf(id),
    name: id,
    icon: languageBadge(id, { theme, logos }),
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
    ...(suggested.length > 0 ? [sectionHeader(t(SUGGESTED_KEY)), ...suggested.map(row), sectionDivider()] : []),
    ...rest.map(row),
  ];
}
