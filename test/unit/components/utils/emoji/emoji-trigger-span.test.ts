import { describe, it, expect } from 'vitest';
import { resolveEmojiTriggerSpan } from '../../../../../src/components/utils/emoji/emoji-trigger-span';

describe('resolveEmojiTriggerSpan', () => {
  const cases: ReadonlyArray<readonly [label: string, text: string, caret: number, expected: { start: number; end: number; query: string } | null]> = [
    ['colon at line start',            ':fi',        3, { start: 0, end: 3, query: 'fi' }],
    ['colon after a space',            'hello :fi',  9, { start: 6, end: 9, query: 'fi' }],
    ['colon inside a time',            '10:30',      5, null],
    ['bare colon',                     ':',          1, null],
    ['whitespace inside the query',    ':fi re',     6, null],
    ['colon inside a url',             'http://',    7, null],
    ['text after the caret is ignored',':firex',     5, { start: 0, end: 5, query: 'fire' }],
    ['colon directly after a word',    'a:b',        3, null],
    ['caret before the colon',         ':fire',      0, null],
    ['second colon wins',              ':a :fi',     6, { start: 3, end: 6, query: 'fi' }],
    ['non-breaking space counts as whitespace', 'x :fi', 5, { start: 2, end: 5, query: 'fi' }],
  ];

  it.each(cases)('%s', (_label, text, caret, expected) => {
    expect(resolveEmojiTriggerSpan(text, caret)).toEqual(expected);
  });
});
