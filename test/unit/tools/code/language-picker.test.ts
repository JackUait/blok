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
const t = (key: string): string => ({ 'tools.code.suggested': 'Suggested', 'tools.code.allLanguages': 'All languages' }[key] ?? key);

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

/** Text of each section header, in order. */
const headers = (items: PopoverItemParams[]): string[] =>
  items.flatMap((item) => (item.type === PopoverItemType.Html ? [item.element.textContent ?? ''] : []));

describe('language badge', () => {
  it('carries a short mark, tinted by the language color, hidden from assistive tech', () => {
    const badge = languageBadge('typescript');

    expect(badge.textContent).toBe('TS');
    expect(badge.style.getPropertyValue('--blok-code-lang')).toBe('#3178c6');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives every listed language a mark of at most three characters', () => {
    const marks = LANGUAGES.map((lang) => languageBadge(lang.id).textContent ?? '');

    expect(marks.every((mark) => mark.length >= 1 && mark.length <= 3)).toBe(true);
  });

  it('falls back to the neutral ink for plain text', () => {
    expect(languageBadge('plain text').style.getPropertyValue('--blok-code-lang')).toBe('var(--blok-gray-text)');
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
  it('lists every language once under "All languages" when there is nothing to suggest', () => {
    const items = build();

    expect(headers(items)).toStrictEqual(['All languages']);
    expect(namesIn(items)).toStrictEqual(LANGUAGES.map((lang) => lang.id));
  });

  it('suggests the filename language, the detected one and recent picks, each once, and drops them from the full list', () => {
    const items = build({ filename: 'app.py', detectedId: 'rust', recent: ['go', 'python'] });
    const names = namesIn(items);

    expect(headers(items)).toStrictEqual(['Suggested', 'All languages']);
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

    expect(headers(items)).toStrictEqual(['All languages']);
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
