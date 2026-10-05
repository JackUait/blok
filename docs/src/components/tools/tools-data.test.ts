// docs/src/components/tools/tools-data.test.ts
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { defaultBlockTools, defaultInlineTools } from '../../../../src/tools/index';
import { DEFAULT_CAPTION_PLACEHOLDER } from '../../../../src/tools/audio/constants';
import {
  DOCUMENTED_BLOCK_TOOL_KEYS,
  DOCUMENTED_INLINE_TOOL_KEYS,
  TOOL_SECTIONS,
} from './tools-data';

/** Repo root — docs/src/components/tools → up four levels. */
const BLOK_ROOT = resolve(__dirname, '..', '..', '..', '..');
const readSource = (rel: string): string => readFileSync(join(BLOK_ROOT, rel), 'utf8');

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('tools documentation coverage', () => {
  it('documents every key in defaultBlockTools', () => {
    for (const key of Object.keys(defaultBlockTools)) {
      expect(
        DOCUMENTED_BLOCK_TOOL_KEYS.has(key),
        `Block tool "${key}" is exported in defaultBlockTools but has no docs entry in tools-data.ts`
      ).toBe(true);
    }
  });

  it('documents every key in defaultInlineTools', () => {
    for (const key of Object.keys(defaultInlineTools)) {
      expect(
        DOCUMENTED_INLINE_TOOL_KEYS.has(key),
        `Inline tool "${key}" is exported in defaultInlineTools but has no docs entry in tools-data.ts`
      ).toBe(true);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty id, title, and description', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.id.length).toBeGreaterThan(0);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty exportName', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.exportName.length).toBeGreaterThan(0);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty usageExample', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.usageExample.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate section ids', () => {
    const ids = TOOL_SECTIONS.map((section) => section.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it('database description only names real PropertyType values', () => {
    // Root cause: the example type list was hand-authored and drifted from the
    // real union. "status" is not a PropertyType — a status column is a `select`.
    // See src/tools/database/types.ts.
    const typesSrc = readSource('src/tools/database/types.ts');
    const union = typesSrc.match(/export type PropertyType\s*=\s*([^;]+);/)?.[1] ?? '';
    const members = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(members).toContain('select');

    const description = TOOL_SECTIONS.find((s) => s.id === 'database')?.description ?? '';
    const listed = description.match(/typed properties \(([^)]+)\)/)?.[1] ?? '';
    const tokens = listed
      .split(',')
      .map((t) => t.trim().replace(/`/g, '').replace(/etc\.?/, '').trim())
      .filter(Boolean);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(members, `database description names "${token}", not a PropertyType`).toContain(token);
    }
  });

  it('audio captionPlaceholder documents the effective default, matching video', () => {
    // Root cause: audio documented the config-level `undefined` instead of the
    // visible fallback (DEFAULT_CAPTION_PLACEHOLDER), diverging from the Video
    // tool which documents the effective value. See src/tools/audio/index.ts.
    const findCaption = (id: string) =>
      TOOL_SECTIONS.find((s) => s.id === id)?.configOptions?.find(
        (o) => o.option === 'captionPlaceholder',
      );
    const audio = findCaption('audio');
    const video = findCaption('video');
    expect(audio).toBeDefined();
    expect(video).toBeDefined();
    expect(audio!.default).toBe(`"${DEFAULT_CAPTION_PLACEHOLDER}"`);
    expect(audio!.default).toBe(video!.default);
  });

  const uploaderCases = [
    { toolId: 'audio', dts: 'types/tools/audio.d.ts' },
    { toolId: 'video', dts: 'types/tools/video.d.ts' },
  ];

  for (const { toolId, dts } of uploaderCases) {
    it(`${toolId} uploader description matches uploadByUrl's real return type`, () => {
      // Root cause: the description claimed both methods resolve to `{ url, fileName? }`,
      // but only uploadByFile does — uploadByUrl resolves to `{ url }`. Ground truth is the
      // uploader type in ${dts}.
      const typeSrc = readSource(dts);
      const uploadByUrlLine = typeSrc.match(/uploadByUrl\?[^\n]*/)?.[0] ?? '';
      expect(uploadByUrlLine).toContain('uploadByUrl');
      expect(
        uploadByUrlLine,
        `${dts}: uploadByUrl unexpectedly declares fileName`,
      ).not.toContain('fileName');

      const uploader = TOOL_SECTIONS.find((s) => s.id === toolId)?.configOptions?.find(
        (o) => o.option === 'uploader',
      );
      const desc = uploader?.description ?? '';
      expect(desc).toContain('uploadByUrl');
      expect(
        desc,
        `${toolId} uploader description claims uploadByUrl resolves to { url, fileName? }, but its type is { url }`,
      ).not.toMatch(/each resolving to `\{ url, fileName\? \}`/);
    });
  }
});

describe('page reference documentation', () => {
  const pageDescriptionIn = (locale: string): string => {
    const catalogue = JSON.parse(readSource(`docs/src/i18n/${locale}.json`)) as {
      tools?: { docs?: { page?: { description?: string } } };
    };

    return catalogue.tools?.docs?.page?.description ?? '';
  };

  it('shows ID-only owning and non-owning saved shapes', () => {
    const page = TOOL_SECTIONS.find((section) => section.id === 'page');
    const pageLink = TOOL_SECTIONS.find((section) => section.id === 'page-link');

    expect(page?.saveDataExample).toContain('"pageId": "p1"');
    expect(page?.saveDataExample).not.toContain('"cache"');
    expect(pageLink?.saveDataExample).toContain('"type": "page-link"');
    expect(pageLink?.saveDataExample).toContain('"pageId"');
    expect(pageLink?.description).toMatch(/non-owning/i);
    expect(pageLink?.saveDataExample).not.toContain('"title"');
    expect(pageLink?.saveDataExample).not.toContain('"href"');
  });

  it('shows the host hooks and safe inline reference format', () => {
    const page = TOOL_SECTIONS.find((section) => section.id === 'page');
    const example = page?.usageExample ?? '';

    expect(example).toContain('PageLink');
    expect(example).toContain('search:');
    expect(example).toContain('subscribe:');
    expect(example).toContain('pageInfo:');
    expect(example).toContain('pageHref:');
    expect(page?.configOptions.map((option) => option.option)).toEqual(expect.arrayContaining([
      'href', 'open', 'resolve', 'create', 'search', 'subscribe',
    ]));
    expect(page?.description).toContain('data-blok-page-id');
    expect(page?.description).toContain('same-tab');
    expect(page?.description).toContain('global search');
    expect(page?.description).not.toContain('saved cache');
  });

  it.each(['en', 'ru'])('explains authorized metadata in %s', (locale) => {
    const description = pageDescriptionIn(locale);

    expect(description).toContain('pageId');
    expect(description).toContain('resolve');
    expect(description).toContain('subscribe');
    expect(description).toContain('search');
    expect(description).toContain('pageInfo');
    expect(description).toContain('pageHref');
    expect(description).not.toContain('cached copy');
    // The page tool never shipped a saved `cache`, so there is no legacy one.
    expect(description).not.toContain('`cache`');
  });

  it.each(['en', 'ru'])('documents the non-owning page link in %s', (locale) => {
    const catalogue = JSON.parse(readSource(`docs/src/i18n/${locale}.json`)) as {
      tools?: {
        docs?: { 'page-link'?: { description?: string } };
        links?: { 'page-link'?: string };
      };
    };

    expect(catalogue.tools?.docs?.['page-link']?.description ?? '').toContain('pageId');
    expect(catalogue.tools?.links?.['page-link']).toBe(locale === 'ru' ? 'Ссылка на страницу' : 'Page link');
  });
});

describe('callout keyboard exit', () => {
  /**
   * A callout holds its text in child blocks, so "how do I get back out" is a
   * question the docs have to answer — every Enter used to add another line
   * inside the panel and Backspace was the only escape. Now Enter on the empty
   * last line leaves the callout, and the docs say so.
   */
  it('documents that Enter on the empty last line exits the callout', () => {
    const description = TOOL_SECTIONS.find((s) => s.id === 'callout')?.description ?? '';

    expect(description).toContain('Enter');
    expect(description).toMatch(/empty last line|blank line/i);
  });
});

describe('callout emoji data preload', () => {
  const calloutDescriptionIn = (locale: string): string => {
    const catalogue = JSON.parse(readSource(`docs/src/i18n/${locale}.json`)) as {
      tools?: { docs?: { callout?: { description?: string } } };
    };

    return catalogue.tools?.docs?.callout?.description ?? '';
  };

  it.each([
    ['tools-data.ts', TOOL_SECTIONS.find((s) => s.id === 'callout')?.description ?? ''],
    ['en.json', calloutDescriptionIn('en')],
    ['ru.json', calloutDescriptionIn('ru')],
  ])('documents preloadEmojiData in %s', (_file, text) => {
    expect(text).toContain('preloadEmojiData');
  });
});

describe('pasted code language', () => {
  /**
   * A pasted code block only keeps its highlighting if the language survives
   * the clipboard, and whether it does is a property of the SOURCE — a fenced
   * markdown block names it, and so does a Gemini answer, while a ChatGPT code
   * block carries no language at all. The docs have to say the language can
   * come across, or the picker looks like the only way to set it.
   */
  it('documents that the language is adopted from a pasted source that names it', () => {
    const description = TOOL_SECTIONS.find((s) => s.id === 'code')?.description ?? '';

    expect(description).toContain('language');
    expect(description).toMatch(/```sql|fence/);
    expect(description).toContain('Gemini');
  });
});
