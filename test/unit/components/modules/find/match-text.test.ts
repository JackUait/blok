import { describe, it, expect } from 'vitest';
import { findTextMatches } from '../../../../../src/components/modules/find/match-text';

const texts = (text: string, query: string, options = {}): string[] =>
  findTextMatches(text, query, options).map(({ start, end }) => text.slice(start, end));

describe('findTextMatches', () => {
  it('returns nothing for an empty or whitespace-only query', () => {
    expect(findTextMatches('hello', '')).toEqual([]);
    expect(findTextMatches('hello   world', '   ')).toEqual([]);
  });

  it('ignores case by default', () => {
    expect(texts('Apple apple APPLE', 'apple')).toEqual(['Apple', 'apple', 'APPLE']);
  });

  it('respects case when matchCase is on', () => {
    expect(texts('Apple apple APPLE', 'apple', { matchCase: true })).toEqual(['apple']);
  });

  it('ignores diacritics in both directions and maps back to the original text', () => {
    expect(texts('Café, cafe, CAFÉ', 'cafe')).toEqual(['Café', 'cafe', 'CAFÉ']);
    expect(texts('naive naïve', 'naïve')).toEqual(['naive', 'naïve']);
  });

  it('keeps offsets right for decomposed accents in the source', () => {
    const decomposed = 'café bar';

    expect(texts(decomposed, 'café')).toEqual(['café']);
  });

  it('treats curly and straight quotes and dashes alike', () => {
    expect(texts('don’t stop', "don't")).toEqual(['don’t']);
    expect(texts('“quoted”', '"quoted"')).toEqual(['“quoted”']);
    expect(texts('2020–2021', '2020-2021')).toEqual(['2020–2021']);
  });

  it('treats a non-breaking space as a space', () => {
    expect(texts('hello world', 'hello world')).toEqual(['hello world']);
  });

  it('matches a run of spaces in the query against a run of spaces in the text', () => {
    expect(texts('hello    world', 'hello world')).toEqual(['hello    world']);
  });

  it('does not overlap matches', () => {
    expect(findTextMatches('aaaa', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it('only matches whole words when wholeWord is on', () => {
    expect(texts('cat concat cat. catalog', 'cat', { wholeWord: true })).toEqual(['cat', 'cat']);
  });

  it('treats letters of any script as word characters for wholeWord', () => {
    expect(texts('кот котик кот', 'кот', { wholeWord: true })).toEqual(['кот', 'кот']);
  });

  it('keeps an emoji whole', () => {
    expect(texts('I 👍 this 👍', '👍')).toEqual(['👍', '👍']);
  });

  it('folds a character whose lowercase form is longer without shifting later matches', () => {
    const text = 'İstanbul and istanbul';

    expect(texts(text, 'istanbul')).toEqual(['İstanbul', 'istanbul']);
  });

  it('never matches part of a Korean syllable', () => {
    expect(findTextMatches('한국', '하')).toEqual([]);
    expect(texts('한국 한국', '한국')).toEqual(['한국', '한국']);
  });

  it('keeps Japanese voiced kana distinct from their plain forms', () => {
    expect(findTextMatches('が', 'か')).toEqual([]);
  });

  it('never matches inside one character that folds to several', () => {
    expect(texts('wait… ok.', '.')).toEqual(['.']);
    expect(texts('wait…', '...')).toEqual(['…']);
  });

  it('sees through zero-width characters and soft hyphens', () => {
    expect(texts('bo​ld and hy­phen', 'bold')).toEqual(['bo​ld']);
    expect(texts('hy­phen', 'hyphen')).toEqual(['hy­phen']);
  });
});
