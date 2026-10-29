import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parsePartialJson, readPartialCommands } from '../../../src/agent/partial-json';

describe('parsePartialJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops bad members one by one without overflowing the stack', () => {
    expect(parsePartialJson(`[${'x,'.repeat(3)}`)).toEqual([]);
    expect(parsePartialJson(`[${'x,'.repeat(20_000)}`)).toEqual([]);
    expect(parsePartialJson('[1,2,x,3,')).toEqual([1, 2]);
    expect(parsePartialJson(`[1,${'2,'.repeat(20_000)}x,3,`)).toHaveLength(20_001);
  });

  it('closes an open string', () => {
    expect(parsePartialJson('{"a":"hel')).toEqual({ a: 'hel' });
  });

  it('closes an open array', () => {
    expect(parsePartialJson('{"a":[1,2')).toEqual({ a: [1, 2] });
  });

  it('drops a trailing key with no value', () => {
    expect(parsePartialJson('{"a":1,"b"')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,"b')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,"b":')).toEqual({ a: 1 });
  });

  it('drops a cut-off literal', () => {
    expect(parsePartialJson('{"a":tr')).toEqual({});
    expect(parsePartialJson('{"a":{"b":nul')).toEqual({ a: {} });
  });

  it('drops a dangling comma', () => {
    expect(parsePartialJson('[1,2,')).toEqual([1, 2]);
    expect(parsePartialJson('{"a":1,')).toEqual({ a: 1 });
  });

  it('keeps an escaped quote inside an open string', () => {
    expect(parsePartialJson('{"a":"x\\"y')).toEqual({ a: 'x"y' });
  });

  it('drops a cut escape', () => {
    expect(parsePartialJson('{"a":"\\u00')).toEqual({ a: '' });
    expect(parsePartialJson('{"a":"ab\\')).toEqual({ a: 'ab' });
  });

  it('reads brackets inside strings as text', () => {
    expect(parsePartialJson('{"a":"[{","b":[')).toEqual({ a: '[{', b: [] });
  });

  it('cuts at the right place after an emoji', () => {
    expect(parsePartialJson('{"a":"😀😀","b":tr')).toEqual({ a: '😀😀' });
  });

  it('returns a finished text as is', () => {
    expect(parsePartialJson('{"a":[1,{"b":"c"}]}')).toEqual({ a: [1, { b: 'c' }] });
  });

  it('returns undefined when nothing usable has arrived', () => {
    expect(parsePartialJson('')).toBeUndefined();
    expect(parsePartialJson('  ')).toBeUndefined();
    expect(parsePartialJson('tr')).toBeUndefined();
  });
});

describe('readPartialCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks every command but the last done while the text is open', () => {
    const json = '{"commands":[{"name":"block.insert","args":{"type":"paragraph","data":{"text":"Hi"}}},{"name":"text.replace","args":{"id":"b1","with":"New te';

    expect(readPartialCommands(json)).toEqual([
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'Hi' } }, done: true },
      { name: 'text.replace', args: { id: 'b1', with: 'New te' }, done: false },
    ]);
  });

  it('marks every command done once the text is finished', () => {
    const json = '{"commands":[{"name":"block.delete","args":{"id":"b1"},"ref":"r1"}],"expectRevision":3}';

    expect(readPartialCommands(json)).toEqual([
      { name: 'block.delete', args: { id: 'b1' }, ref: 'r1', done: true },
    ]);
  });

  it('gives a command with no args yet empty args', () => {
    expect(readPartialCommands('{"commands":[{"name":"block.ins')).toEqual([
      { name: 'block.ins', args: {}, done: false },
    ]);
  });

  it('returns no commands before the list arrives', () => {
    expect(readPartialCommands('')).toEqual([]);
    expect(readPartialCommands('{"comm')).toEqual([]);
    expect(readPartialCommands('{"commands":"x"}')).toEqual([]);
  });
});
