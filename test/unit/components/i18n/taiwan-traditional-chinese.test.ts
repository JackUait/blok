import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type Messages = Record<string, string>;

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

const loadMessages = (locale: string): Messages =>
  JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8')) as Messages;

const extractPlaceholders = (value: string): string[] =>
  [...value.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter((placeholder): placeholder is string => placeholder !== undefined)
    .sort();

describe('Taiwan Traditional Chinese translations', () => {
  const english = loadMessages('en');
  const simplified = loadMessages('zh');
  const taiwan = loadMessages('zh-TW');

  it('has exactly the English source keys in source order with no empty values', () => {
    expect(Object.keys(taiwan)).toEqual(Object.keys(english));

    const empty = Object.entries(taiwan)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it('preserves every interpolation placeholder exactly', () => {
    const mismatches = Object.entries(english).flatMap(([key, source]) => {
      const expected = extractPlaceholders(source);
      const actual = extractPlaceholders(taiwan[key] ?? '');

      return JSON.stringify(actual) === JSON.stringify(expected)
        ? []
        : [`${key}: expected {${expected.join(', ')}}, received {${actual.join(', ')}}`];
    });

    expect(mismatches).toEqual([]);
  });

  it('is a distinct localization rather than the Simplified Chinese dictionary', () => {
    const differingValues = Object.keys(taiwan).filter((key) => taiwan[key] !== simplified[key]);

    expect(differingValues.length).toBeGreaterThan(100);
  });

  it('uses established Taiwan product terminology', () => {
    expect(taiwan['blockSettings.dragToMove']).toBe('拖曳以移動');
    expect(taiwan['toolbox.addBelow']).toBe('點擊以在下方新增');
    expect(taiwan['popover.search']).toBe('搜尋');
    expect(taiwan['blockSettings.delete']).toBe('刪除');
    expect(taiwan['toolNames.file']).toBe('檔案');
    expect(taiwan['toolNames.link']).toBe('連結');
    expect(taiwan['toolNames.video']).toBe('影片');
    expect(taiwan['tools.table.headerColumn']).toBe('標題欄');
    expect(taiwan['tools.table.headerRow']).toBe('標題列');
  });

  it('contains no Simplified-only characters or Mainland UI terms', () => {
    const simplifiedOnly = /[动块链页档视频图复删选显载栏划线开关这为个与发后错应处从将调层并网标签览击键项据库]/u;
    const mainlandTerms = [
      '文本',
      '鼠标',
      '软件',
      '视频',
      '音频',
      '链接',
      '数据',
      '默认',
      '用户',
      '剪贴板',
      '全屏',
      '居中',
      '单元格',
      '下划线',
      '复选框',
    ];

    const offenders = Object.entries(taiwan).flatMap(([key, value]) => {
      const terms = mainlandTerms.filter((term) => value.includes(term));

      return simplifiedOnly.test(value) || terms.length > 0
        ? [`${key}: "${value}"${terms.length > 0 ? ` (${terms.join(', ')})` : ''}`]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
