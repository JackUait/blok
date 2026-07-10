import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildConvertMenuEntries, type ConvertMenuI18n } from '../../../../src/components/utils/convert-menu';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';

/**
 * i18n stub: t() echoes a "translated:<key>" string, has() is always true,
 * getEnglishTranslation() echoes "en:<key>". This lets assertions check that
 * the correct key was resolved without depending on real dictionaries.
 */
const createI18n = (): ConvertMenuI18n => ({
  t: (key: string) => `translated:${key}`,
  has: () => true,
  getEnglishTranslation: (key: string) => `en:${key}`,
});

/**
 * Build a BlockToolAdapter stub with a name and toolbox entries.
 */
const createToolStub = (
  name: string,
  toolbox: BlockToolAdapter['toolbox'],
): BlockToolAdapter => ({
  name,
  toolbox,
} as unknown as BlockToolAdapter);

describe('buildConvertMenuEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a titleKey-only toolbox entry to a non-empty title (the inline-menu bug)', () => {
    const quote = createToolStub('quote', [
      { icon: '<svg>q</svg>', titleKey: 'quote' },
    ]);

    const [entry] = buildConvertMenuEntries([quote], createI18n());

    expect(entry.title).toBe('translated:toolNames.quote');
    expect(entry.toolName).toBe('quote');
    expect(entry.name).toBe('quote');
  });

  it('produces one entry per toolbox item across multiple tools', () => {
    const tools = [
      createToolStub('paragraph', [{ icon: '<svg>p</svg>', titleKey: 'text' }]),
      createToolStub('list', [
        { icon: '<svg>ul</svg>', titleKey: 'bulletedList', name: 'bulleted-list', data: { style: 'unordered' } },
        { icon: '<svg>ol</svg>', titleKey: 'numberedList', name: 'numbered-list', data: { style: 'ordered' } },
      ]),
    ];

    const entries = buildConvertMenuEntries(tools, createI18n());

    expect(entries.map((e) => e.name)).toEqual(['paragraph', 'bulleted-list', 'numbered-list']);
    expect(entries[1].data).toEqual({ style: 'unordered' });
    expect(entries[2].toolName).toBe('list');
  });

  it('uses a raw title when present (header variants)', () => {
    const header = createToolStub('header', [
      { icon: '<svg>h1</svg>', title: 'Heading 1', titleKey: 'heading1', data: { level: 1 } },
    ]);

    const [entry] = buildConvertMenuEntries([header], createI18n());

    // translateToolTitle prefers titleKey, but a raw title guarantees non-undefined.
    expect(entry.title).not.toBe('');
    expect(entry.englishTitle).toBe('en:toolNames.heading1');
  });

  it('skips entries without an icon', () => {
    const broken = createToolStub('broken', [
      { titleKey: 'text' },
      { icon: '<svg>ok</svg>', titleKey: 'quote' },
    ]);

    const entries = buildConvertMenuEntries([broken], createI18n());

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('translated:toolNames.quote');
  });

  it('falls back englishTitle to the raw title when no titleKey', () => {
    const external = createToolStub('external', [
      { icon: '<svg>x</svg>', title: 'External' },
    ]);

    const [entry] = buildConvertMenuEntries([external], createI18n());

    expect(entry.englishTitle).toBe('External');
  });
});
