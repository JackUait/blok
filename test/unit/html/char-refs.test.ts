import { describe, expect, it } from 'vitest';
import { decodeAll, hitsEntitiesBug, parse5Attribute, parse5Text } from './entities-oracle-bug';
import { LEGACY_ENTITIES } from '../../../src/html/legacy-entities';
import { PACKED_ENTITIES } from '../../../src/markdown/engine/entities';

const names = [
  ...PACKED_ENTITIES.split('~').map((pair) => `${pair.slice(0, pair.indexOf(' '))};`),
  ...LEGACY_ENTITIES.split(' '),
];
// Inputs parse5 8.0.1 (entities 8.0.0 inside) misreads; see entities-oracle-bug.ts.
// entities 8.1.0, which follows the spec, agreed with us on every input (checked out of tree).
const KNOWN_ORACLE_BUGS = 364;
const SUFFIXES = ['', ';', '=', 'x', 'Z', '1', '#', ' ', '<', '&amp;', '"'];

describe('readCharRef', () => {
  it('knows all 2231 names', () => {
    expect(names).toHaveLength(2231);
  });

  it('decodes every name like parse5, in text and in attributes', () => {
    const inputs = names.flatMap((name) => {
      const bare = name.replace(/;$/, '');

      return SUFFIXES.flatMap((suffix) => [`&${bare}${suffix}`, `&${name}${suffix}`, `a&${bare.slice(0, -1)}${suffix}`]);
    });
    const checked = inputs.filter((input) => !hitsEntitiesBug(input));
    const textDiffs = checked.filter((input) => decodeAll(input, false) !== parse5Text(input));
    const attrDiffs = checked.filter((input) => decodeAll(input, true) !== parse5Attribute(input));

    expect(inputs.length - checked.length).toBe(KNOWN_ORACLE_BUGS);
    expect(textDiffs).toEqual([]);
    expect(attrDiffs).toEqual([]);
  });

  it('reads a name that needs a `;` as text when the `;` is missing', () => {
    expect(decodeAll('&Gdot ', false)).toBe('&Gdot ');
    expect(decodeAll('&Ocy"', true)).toBe('&Ocy"');
    expect(decodeAll('&eta=', false)).toBe('&eta=');
    expect(decodeAll('&backepsilonx', false)).toBe('&backepsilonx');
  });

  it('takes the longest name, with or without a semicolon', () => {
    expect(decodeAll('&notit;', false)).toBe('¬it;');
    expect(decodeAll('&notin;', false)).toBe('∉');
    expect(decodeAll('&notin', false)).toBe('¬in');
    expect(decodeAll('&ampx', false)).toBe('&x');
    expect(decodeAll('&ampx', true)).toBe('&ampx');
    expect(decodeAll('&amp=', true)).toBe('&amp=');
    expect(decodeAll('&amp#', true)).toBe('&#');
    expect(decodeAll('&amp;x', true)).toBe('&x');
    expect(decodeAll('&xyz;', false)).toBe('&xyz;');
  });

  it('decodes numeric references like parse5', () => {
    const codes = [
      0, 9, 10, 12, 13, 32, 65, 0x7f, 0x80, 0x81, 0x8d, 0x9f, 0xa0, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000,
      0xfdd0, 0xfffe, 0xffff, 0x10000, 0x1f600, 0x10fffe, 0x10ffff, 0x110000, 0xffffffff,
      ...Array.from({ length: 32 }, (_, i) => 0x80 + i),
    ];
    const inputs = codes.flatMap((code) => [
      `&#${code};`, `&#${code}`, `&#${code}x`, `&#x${code.toString(16)};`, `&#X${code.toString(16).toUpperCase()}`,
      `&#x${code.toString(16)}g;`, `&#000${code};`, `&#x000${code.toString(16)}`,
    ]);
    const odd = ['&#', '&#;', '&#x', '&#x;', '&#X;', '&#xg;', '&#a;', `&#${'9'.repeat(400)};`, `&#x${'f'.repeat(400)}`, '&#-1;', '&#+1;'];
    const all = [...inputs, ...odd];

    expect(all.filter((input) => decodeAll(input, false) !== parse5Text(input))).toEqual([]);
    expect(all.filter((input) => decodeAll(input, true) !== parse5Attribute(input))).toEqual([]);
  });

  it('maps the C1 window and invalid code points', () => {
    expect(decodeAll('&#128;&#0;&#xD800;&#x110000;&#x41;', false)).toBe('€���A');
  });
});
