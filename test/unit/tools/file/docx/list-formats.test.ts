import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listFormat } from '../../../../../src/tools/file/docx/list-formats';

const run = (format: string, values: number[]): Array<string | null> => values.map((n) => listFormat(n, format));

describe('listFormat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts Chinese informally, with 零 for a gap and no 一 before a leading 十', () => {
    expect(run('chineseCounting', [1, 10, 11, 20, 21, 100, 101, 110, 1000, 1001])).toEqual(
      ['一', '十', '十一', '二十', '二十一', '一百', '一百零一', '一百一十', '一千', '一千零一'],
    );
  });

  it('counts Japanese informally, dropping 一 before every unit and never writing a zero', () => {
    expect(run('japaneseCounting', [1, 10, 11, 100, 101, 1000, 1100])).toEqual(['一', '十', '十一', '百', '百一', '千', '千百']);
  });

  it('writes formal Chinese with financial digits and 壹 before every unit', () => {
    expect(run('chineseLegalSimplified', [1, 10, 12, 101])).toEqual(['壹', '壹拾', '壹拾贰', '壹佰零壹']);
    expect(run('ideographLegalTraditional', [3, 30])).toEqual(['參', '參拾']);
  });

  it('writes Korean counting in hangul', () => {
    expect(run('koreanCounting', [1, 10, 11, 25])).toEqual(['일', '일십', '일십일', '이십오']);
  });

  it('substitutes digits for Thai, Devanagari and ideographic digital formats', () => {
    expect(run('thaiNumbers', [12])).toEqual(['๑๒']);
    expect(run('hindiNumbers', [305])).toEqual(['३०५']);
    expect(run('ideographDigital', [10])).toEqual(['一〇']);
  });

  it('walks the kana, hangul and stem alphabets, doubling after the last letter', () => {
    expect(run('aiueo', [1, 2, 48, 49])).toEqual(['ア', 'イ', 'ン', 'アア']);
    expect(run('iroha', [1, 3])).toEqual(['イ', 'ハ']);
    expect(run('ganada', [1, 14, 15])).toEqual(['가', '하', '가가']);
    expect(run('chosung', [2])).toEqual(['ㄴ']);
    expect(run('ideographTraditional', [1, 10])).toEqual(['甲', '癸']);
    expect(run('ideographZodiac', [12])).toEqual(['亥']);
  });

  it('writes Hebrew numerals additively, with טו and טז for 15 and 16', () => {
    expect(run('hebrew1', [1, 10, 15, 16, 19, 100, 345])).toEqual(['א', 'י', 'טו', 'טז', 'יט', 'ק', 'שמה']);
  });

  it('answers null for formats it does not know and for values past its range', () => {
    expect(listFormat(3, 'cardinalText')).toBeNull();
    expect(listFormat(10_000, 'chineseCounting')).toBeNull();
    expect(listFormat(1000, 'hebrew1')).toBeNull();
    expect(listFormat(0, 'aiueo')).toBeNull();
  });
});
