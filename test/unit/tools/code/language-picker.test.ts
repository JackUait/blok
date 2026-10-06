import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PopoverItemDefaultParams, PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import {
  buildLanguagePickerItems,
  languageBadge,
  languageForFilename,
  readRecentLanguages,
  rememberLanguage,
  RECENT_LANGUAGES_STORAGE_KEY,
} from '../../../../src/tools/code/language-picker';
import { LANGUAGES } from '../../../../src/tools/code/constants';
import { LANGUAGE_LOGOS } from '../../../../src/tools/code/language-logos';

const NAMES: Record<string, string> = { 'plain text': 'Plain text' };
const nameOf = (id: string): string => NAMES[id] ?? LANGUAGES.find((l) => l.id === id)?.name ?? id;
const t = (key: string): string => ({ 'tools.code.suggested': 'Suggested' }[key] ?? key);

const build = (overrides: Partial<Parameters<typeof buildLanguagePickerItems>[0]> = {}): PopoverItemParams[] =>
  buildLanguagePickerItems({
    theme: 'light',
    logos: LANGUAGE_LOGOS,
    selectedId: 'plain text',
    detectedId: null,
    filename: '',
    recent: [],
    nameOf,
    t,
    onPick: vi.fn(),
    ...overrides,
  });

const isDefault = (item: PopoverItemParams): item is PopoverItemDefaultParams =>
  item.type === undefined || item.type === PopoverItemType.Default;

const namesIn = (items: PopoverItemParams[]): string[] => items.filter(isDefault).map((item) => item.name ?? '');

/** Each non-option row, in order: a header's text, or '—' for a divider. */
const headers = (items: PopoverItemParams[]): string[] =>
  items.flatMap((item) => (item.type === PopoverItemType.Html ? [item.element.textContent || '—'] : []));

const channel = (hex: string, at: number): number => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

const LIGHT_MENU = '#ffffff';
const DARK_MENU = '#252525';

const rgbToHex = (rgb: string): string =>
  `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;

describe('language badge', () => {
  it('draws the real logo, flat, in its brand color', () => {
    const badge = languageBadge('typescript', { theme: 'light', logos: LANGUAGE_LOGOS });
    const path = badge.querySelector('svg path');

    expect(path?.getAttribute('d')).toBe(LANGUAGE_LOGOS.typescript.path);
    expect(rgbToHex(badge.style.color)).toBe('#3178c6');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    // No tile, gradient or glow around the mark.
    expect(badge.className).not.toMatch(/gradient|shadow|bg-/);
  });

  it('fills the JS letter holes black, like the real mark', () => {
    const badge = languageBadge('javascript', { theme: 'light', logos: LANGUAGE_LOGOS });

    expect(badge.querySelector('svg rect')?.getAttribute('fill')).toBe('#000000');
    // A square mark carries its own contrast, so its yellow is never darkened.
    expect(rgbToHex(badge.style.color)).toBe('#f7df1e');
  });

  it('gives a language with no vendored logo a flat square monogram, like the JS and TS marks', () => {
    const badge = languageBadge('rust', { theme: 'light', logos: LANGUAGE_LOGOS });
    const square = badge.querySelector<HTMLElement>('[data-monogram]');

    expect(badge.querySelector('svg')).toBeNull();
    expect(square?.textContent).toBe('Rs');
    expect(square?.className).not.toMatch(/gradient|shadow/);
  });

  it('inks every monogram at WCAG AA on its square', () => {
    const failing = LANGUAGES
      .filter((lang) => lang.id !== 'plain text' && LANGUAGE_LOGOS[lang.id] === undefined)
      .map((lang) => {
        const square = languageBadge(lang.id, { theme: 'light', logos: LANGUAGE_LOGOS }).querySelector<HTMLElement>('[data-monogram]');

        return { id: lang.id, ratio: contrast(rgbToHex(square?.style.backgroundColor ?? ''), rgbToHex(square?.style.color ?? '')) };
      })
      .filter(({ ratio }) => ratio < 4.5);

    expect(failing).toStrictEqual([]);
  });

  it('shows the monogram until the logos have loaded', () => {
    const badge = languageBadge('typescript', { theme: 'light', logos: null });

    expect(badge.querySelector('svg')).toBeNull();
    expect(badge.querySelector('[data-monogram]')?.textContent).toBe('TS');
  });

  it('keeps every mark at 3:1 against the menu in both themes', () => {
    const failing = (['light', 'dark'] as const).flatMap((theme) =>
      LANGUAGES
        .filter((lang) => LANGUAGE_LOGOS[lang.id] !== undefined && LANGUAGE_LOGOS[lang.id].inner === undefined)
        .map((lang) => {
          const color = rgbToHex(languageBadge(lang.id, { theme, logos: LANGUAGE_LOGOS }).style.color);

          return { id: lang.id, theme, ratio: contrast(color, theme === 'dark' ? DARK_MENU : LIGHT_MENU) };
        })
        .filter(({ ratio }) => ratio < 3));

    expect(failing).toStrictEqual([]);
  });

  it('lifts a black logo to a light ink in dark mode', () => {
    const color = rgbToHex(languageBadge('json', { theme: 'dark', logos: LANGUAGE_LOGOS }).style.color);

    expect(luminance(color)).toBeGreaterThan(luminance('#808080'));
  });

  it('gives every listed language a mark of at most three characters', () => {
    const marks = LANGUAGES.map((lang) => languageBadge(lang.id, { theme: 'light', logos: null }).textContent ?? '');

    expect(marks.every((mark) => mark.length >= 1 && mark.length <= 3)).toBe(true);
  });

  it('gives plain text a neutral ¶', () => {
    const badge = languageBadge('plain text', { theme: 'light', logos: LANGUAGE_LOGOS });

    expect(badge.textContent).toBe('¶');
    expect(badge.getAttribute('data-neutral')).toBe('true');
  });

  it('grows a touch with its row on hover and keyboard focus, only when motion is welcome', () => {
    const { className } = languageBadge('go', { theme: 'light', logos: LANGUAGE_LOGOS });

    expect(className).toContain('motion-safe:in-[[data-blok-popover-item]:hover]:scale-110');
    expect(className).toContain('motion-safe:in-[[data-blok-focused=true]]:scale-110');
  });
});

describe('languageForFilename', () => {
  it.each([
    ['src/block.ts', 'typescript'],
    ['main.go', 'go'],
    ['README.md', 'markdown'],
    ['flow.mmd', 'mermaid'],
    ['paper.tex', 'latex'],
    ['Dockerfile', 'dockerfile'],
    ['notes', null],
    ['', null],
  ])('%s -> %s', (filename, expected) => {
    expect(languageForFilename(filename)).toBe(expected);
  });
});

describe('recent languages', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps the last three picks, newest first, without repeats', () => {
    ['go', 'rust', 'python', 'go', 'java'].forEach(rememberLanguage);

    expect(readRecentLanguages()).toStrictEqual(['java', 'go', 'python']);
  });

  it('never remembers plain text', () => {
    rememberLanguage('plain text');

    expect(readRecentLanguages()).toStrictEqual([]);
  });

  it('ignores unknown ids and junk in storage', () => {
    localStorage.setItem(RECENT_LANGUAGES_STORAGE_KEY, JSON.stringify(['go', 'klingon', 7]));

    expect(readRecentLanguages()).toStrictEqual(['go']);

    localStorage.setItem(RECENT_LANGUAGES_STORAGE_KEY, '{not json');

    expect(readRecentLanguages()).toStrictEqual([]);
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => rememberLanguage('go')).not.toThrow();
    expect(readRecentLanguages()).toStrictEqual([]);
  });
});

describe('buildLanguagePickerItems', () => {
  it('lists every language once, with no header, when there is nothing to suggest', () => {
    const items = build();

    expect(headers(items)).toStrictEqual([]);
    expect(namesIn(items)).toStrictEqual(LANGUAGES.map((lang) => lang.id));
  });

  it('suggests the filename language, the detected one and recent picks, each once, and drops them from the full list', () => {
    const items = build({ filename: 'app.py', detectedId: 'rust', recent: ['go', 'python'] });
    const names = namesIn(items);

    // A divider, not an "All languages" label, ends the suggestions.
    expect(headers(items)).toStrictEqual(['Suggested', '—']);
    expect(names.slice(0, 3)).toStrictEqual(['python', 'rust', 'go']);
    expect(names.filter((name) => name === 'python')).toHaveLength(1);
    expect(names).toHaveLength(LANGUAGES.length);
  });

  it('marks the detected suggestion as auto', () => {
    const items = build({ detectedId: 'rust' }).filter(isDefault);

    expect(items.find((item) => item.name === 'rust')?.secondaryLabel).toBe('tools.code.autoDetected');
  });

  it('does not suggest the language that is already selected', () => {
    const items = build({ selectedId: 'go', recent: ['go'] });

    expect(headers(items)).toStrictEqual([]);
  });

  it('marks the selected language with a check and as the chosen radio', () => {
    const items = build({ selectedId: 'go' }).filter(isDefault);
    const go = items.find((item) => item.name === 'go');
    const java = items.find((item) => item.name === 'java');

    expect(go?.trailingIcon).toBeDefined();
    expect(java?.trailingIcon).toBeUndefined();
    expect(items.every((item) => item.toggle === 'language')).toBe(true);
    expect(go?.isActive).toBe(true);
    expect(java?.isActive).toBe(false);
  });

  it('gives each language a badge icon and its short names as search terms', () => {
    const items = build().filter(isDefault);
    const ts = items.find((item) => item.name === 'typescript');
    const cs = items.find((item) => item.name === 'csharp');

    expect(ts?.icon).toBeInstanceOf(HTMLElement);
    expect(ts?.searchTerms).toEqual(expect.arrayContaining(['ts', '.ts', 'tsx']));
    expect(cs?.searchTerms).toEqual(expect.arrayContaining(['c#', 'cs']));
    expect(items.find((item) => item.name === 'go')?.searchTerms).toContain('golang');
  });

  it('picks through onPick', () => {
    const onPick = vi.fn();
    const go = build({ onPick }).filter(isDefault).find((item) => item.name === 'go');

    go?.onActivate?.(go);

    expect(onPick).toHaveBeenCalledWith('go');
  });
});
