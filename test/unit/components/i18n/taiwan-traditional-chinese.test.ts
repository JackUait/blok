import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type Messages = Record<string, string>;

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

const loadMessages = (locale: string): Messages =>
  JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')) as Messages;

const extractPlaceholders = (value: string): string[] =>
  [...value.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter((placeholder): placeholder is string => placeholder !== undefined)
    .sort();

const UNIVERSAL_IDENTICAL_KEYS = [
  'blockSettings.menuShortcutMac',
  'blockSettings.menuShortcutWin',
  'tools.database.propertyTypeUrl',
  'tools.image.cropRatio16to9',
  'tools.image.cropRatio1to1',
  'tools.image.cropRatio4to3',
];

const GUIDELINE_EXPECTATIONS: Messages = {
  'blockSettings.clickToOpenMenu': '按一下以開啟選單',
  'blockSettings.clickAction': '按一下',
  'toolbox.addBelow': '按一下以在下方新增',
  'toolbox.optionAddAbove': '按住 ⌥ 並按一下，即可在上方新增',
  'toolbox.ctrlAddAbove': '按住 Ctrl 並按一下，即可在上方新增',
  'tools.toggle.bodyPlaceholder': '空白收合區塊。按一下以新增區塊，或將區塊拖曳至此。',
  'tools.table.clickToAddRow': '按一下以新增一列',
  'tools.table.clickToAddColumn': '按一下以新增一欄',
  'tools.table.fitToPageWidth': '配合頁面寬度',
  'blockSettings.lastEditedBy': '上次由 {name} 編輯',
  'a11y.dragHandle': '拖曳以移動區塊，或按一下以開啟選單',
  'searchTerms.delimiter': '分隔標記',
  'searchTerms.unordered': '無編號清單',
  'searchTerms.ordered': '編號清單',
  'toolNames.equation': '方程式',
  'tools.equation.placeholder': '輸入 LaTeX 方程式…',
  'tools.image.converting': '轉換中…',
  'tools.image.errorFileTooLarge': '圖片太大。{size} 超過 {max} 上限。',
  'tools.image.errorSourceOffline': '來源檔案可能已移動或處於離線狀態。',
  'tools.file.errorFileTooLarge': '檔案太大。{size} 超過 {max} 上限。',
  'tools.file.previewRender': '預覽',
  'tools.video.loop': '重複播放',
  'tools.video.errorFileTooLarge': '影片太大。{size} 超過 {max} 上限。',
  'tools.audio.loop': '重複播放',
  'tools.audio.errorFileTooLarge': '音訊檔案太大。{size} 超過 {max} 上限。',
  'tools.audio.titlePlaceholder': '曲目名稱',
  'tools.audio.artistPlaceholder': '藝人',
  'tools.audio.coverChange': '更換封面',
  'tools.audio.coverSet': '設定封面圖片',
  'tools.audio.coverRemove': '移除封面',
  'tools.audio.coverErrorType': '請選擇圖片檔案',
  'tools.audio.coverErrorTooLarge': '圖片太大',
  'tools.audio.coverAdd': '新增封面',
  'tools.audio.coverSourceAria': '封面來源',
  'tools.database.titlePlaceholder': '新資料庫',
  'tools.database.viewTypeBoardDescription': '以多欄顯示項目',
  'tools.database.viewTypeListDescription': '在簡單清單中顯示項目',
  'tools.video.ctxCopyUrlAtTime': '複製目前播放位置的影片網址',
};

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

  it('matches English only for universal notation', () => {
    const identicalKeys = Object.keys(english)
      .filter((key) => taiwan[key] === english[key])
      .sort();

    expect(identicalKeys).toEqual(UNIVERSAL_IDENTICAL_KEYS);
  });

  it('keeps every tool name short and localized', () => {
    const offenders = Object.entries(taiwan).flatMap(([key, value]) => {
      if (!key.startsWith('toolNames.')) {
        return [];
      }

      return /[A-Za-z]/u.test(value) || Array.from(value).length > 6
        ? [`${key}: "${value}"`]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  it('uses natural Taiwan wording in each audited UI context', () => {
    const mismatches = Object.entries(GUIDELINE_EXPECTATIONS).flatMap(([key, expected]) =>
      taiwan[key] === expected ? [] : [`${key}: expected "${expected}", received "${taiwan[key]}"`]
    );

    expect(mismatches).toEqual([]);
  });

  it('is a distinct localization rather than the Simplified Chinese dictionary', () => {
    const differingValues = Object.keys(taiwan).filter((key) => taiwan[key] !== simplified[key]);

    expect(differingValues.length).toBeGreaterThan(100);
  });

  it('uses established Taiwan product terminology', () => {
    expect(taiwan['blockSettings.dragToMove']).toBe('拖曳以移動');
    expect(taiwan['toolbox.addBelow']).toBe('按一下以在下方新增');
    expect(taiwan['popover.search']).toBe('搜尋動作…');
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
