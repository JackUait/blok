import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tokenize } from '../../../../../src/tools/database/formula/tokenizer';

const kinds = (source: string): string[] => {
  const result = tokenize(source);

  if (!result.ok) throw new Error(result.error.message);

  return result.tokens.map((t) => `${t.type}:${t.value}`);
};

describe('formula tokenizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads numbers, strings, identifiers and punctuation', () => {
    expect(kinds('prop("Price") * 1.5')).toEqual([
      'ident:prop', 'punct:(', 'string:Price', 'punct:)', 'op:*', 'number:1.5', 'eof:',
    ]);
  });

  it('reads every documented operator, longest match first', () => {
    expect(kinds('== != !== === >= <= > < && || ! + - * / % ^ ? :')).toEqual([
      'op:==', 'op:!=', 'op:!=', 'op:==', 'op:>=', 'op:<=', 'op:>', 'op:<', 'op:&&', 'op:||',
      'op:!', 'op:+', 'op:-', 'op:*', 'op:/', 'op:%', 'op:^', 'op:?', 'op::', 'eof:',
    ]);
  });

  it('decodes string escapes so "\\\\d" reaches the regex as \\d', () => {
    expect(kinds('"\\\\d" "a\\"b" "x\\ny"')).toEqual(['string:\\d', 'string:a"b', 'string:x\ny', 'eof:']);
  });

  it('skips block comments and line breaks', () => {
    expect(kinds('1 /* a\ncomment */\n+\t2')).toEqual(['number:1', 'op:+', 'number:2', 'eof:']);
  });

  it('reads a stored property reference', () => {
    expect(kinds('{{property:abc-1}} + 1')).toEqual(['propRef:abc-1', 'op:+', 'number:1', 'eof:']);
  });

  it('keeps source offsets on every token', () => {
    const result = tokenize('  ab + 12');

    expect(result.ok && result.tokens.map((t) => [t.start, t.end])).toEqual([[2, 4], [5, 6], [7, 9], [9, 9]]);
  });

  it('reports an unterminated string with its span', () => {
    expect(tokenize('1 + "abc')).toEqual({ ok: false, error: { message: 'Unterminated string', code: 'unterminatedString', params: {}, start: 4, end: 8 } });
  });

  it('reports an unterminated comment', () => {
    expect(tokenize('1 /* x')).toMatchObject({ ok: false, error: { message: 'Unterminated comment', start: 2 } });
  });

  it('reports an unexpected character', () => {
    expect(tokenize('1 # 2')).toEqual({ ok: false, error: { message: 'Unexpected character "#"', code: 'unexpectedCharacter', params: { char: '#' }, start: 2, end: 3 } });
  });

  it('reads exponents and leading-dot decimals', () => {
    expect(kinds('1e3 .5 2.5E-1')).toEqual(['number:1e3', 'number:.5', 'number:2.5E-1', 'eof:']);
  });

  it('reads unicode identifiers used as let variables', () => {
    expect(kinds('let(größe_1, 2, größe_1)')).toEqual([
      'ident:let', 'punct:(', 'ident:größe_1', 'punct:,', 'number:2', 'punct:,', 'ident:größe_1', 'punct:)', 'eof:',
    ]);
  });
});
