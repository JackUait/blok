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

const NAMES: Record<string, string> = { 'plain text': 'Plain text' };
const nameOf = (id: string): string => NAMES[id] ?? LANGUAGES.find((l) => l.id === id)?.name ?? id;
const t = (key: string): string => ({ 'tools.code.suggested': 'Suggested' }[key] ?? key);

const build = (overrides: Partial<Parameters<typeof buildLanguagePickerItems>[0]> = {}): PopoverItemParams[] =>
  buildLanguagePickerItems({
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

describe('language badge', () => {
  it('carries a short mark on the full language color, hidden from assistive tech', () => {
    const badge = languageBadge('typescript');

    expect(badge.textContent).toBe('TS');
    expect(badge.style.getPropertyValue('--blok-code-lang')).toBe('#3178c6');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    // A solid tile, not a pale wash.
    expect(badge.className).not.toMatch(/var\(--blok-code-lang\)_1\d%,transparent/);
  });

  it('gives every listed language a mark of at most three characters', () => {
    const marks = LANGUAGES.map((lang) => languageBadge(lang.id).textContent ?? '');

    expect(marks.every((mark) => mark.length >= 1 && mark.length <= 3)).toBe(true);
  });

  it('inks each mark white or near-black, whichever reads on its color: black JS, white TS', () => {
    expect(languageBadge('javascript').style.getPropertyValue('--blok-code-lang-ink')).toBe('#1b1a17');
    expect(languageBadge('typescript').style.getPropertyValue('--blok-code-lang-ink')).toBe('#ffffff');
  });

  it('deepens a mid-tone color just enough for white to pass, keeping its hue', () => {
    const java = languageBadge('java');

    expect(java.style.getPropertyValue('--blok-code-lang-ink')).toBe('#ffffff');
    expect(java.style.getPropertyValue('--blok-code-lang')).not.toBe('#b07219');
  });

  it('keeps every colored mark at WCAG AA on its tile', () => {
    const failing = LANGUAGES
      .filter((lang) => lang.id !== 'plain text')
      .map((lang) => {
        const badge = languageBadge(lang.id);

        return {
          id: lang.id,
          ratio: contrast(badge.style.getPropertyValue('--blok-code-lang'), badge.style.getPropertyValue('--blok-code-lang-ink')),
        };
      })
      .filter(({ ratio }) => ratio < 4.5);

    expect(failing).toStrictEqual([]);
  });

  it('gives plain text a neutral frosted tile instead of a language color', () => {
    const badge = languageBadge('plain text');

    expect(badge.style.getPropertyValue('--blok-code-lang')).toBe('');
    expect(badge.getAttribute('data-neutral')).toBe('true');
    // Centered, not set in the corner like a language mark.
    expect(badge.className.split(' ')).toEqual(expect.arrayContaining(['items-center', 'justify-center']));
    expect(badge.className.split(' ')).not.toContain('items-end');
  });

  it('lifts with its row on hover and keyboard focus, and holds still under reduced motion', () => {
    const { className } = languageBadge('go');

    expect(className).toContain('motion-safe:in-[[data-blok-popover-item]:hover]:-translate-y-px');
    expect(className).toContain('motion-safe:in-[[data-blok-focused=true]]:-translate-y-px');
    expect(className).toContain('motion-reduce:transition-none');
    expect(className).not.toMatch(/(^| )in-\[[^ ]*translate/);
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

    go?.onActivate(go);

    expect(onPick).toHaveBeenCalledWith('go');
  });
});
