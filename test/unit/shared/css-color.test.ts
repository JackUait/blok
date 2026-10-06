import { describe, expect, it } from 'vitest';
import { CSS_NAMED_COLORS, isSafeCssColor } from '../../../src/shared/css-color';

const VALID = [
  '#abc',
  '#ABCD',
  '#aabbcc',
  '#aabbccdd',
  'rgb(255, 0, 0)',
  'rgba(255,0,0,0.5)',
  'rgb( 11 , 22 , 33 )',
  'rgb(10%, 20%, 30%)',
  'rgb(1 2 3)',
  'rgb(1 2 3 / 50%)',
  'rgb(1 2 3/0.5)',
  'rgba(1.5 2 3 / .5)',
  'RGB(1 2 3)',
  'hsl(120, 50%, 50%)',
  'hsla(120, 50%, 50%, 0.8)',
  'hsl(10 20% 30%)',
  'hsl(10 20 30)',
  'hsl(10deg 20% 30% / 40%)',
  'hsl(0.5turn 20% 30%)',
  'hsl(-30 20% 30%)',
  'hsla(1rad, 20%, 30%, 1)',
  'transparent',
  'currentcolor',
  'currentColor',
  'red',
  'Red',
  'rebeccapurple',
  'lightgoldenrodyellow',
  'var(--blok-color-red-bg)',
  'var(--blok-color-gray-text)',
  'var(--brand_1)',
];

const INVALID = [
  '',
  ' red',
  'red ',
  'not-a-color',
  'transparently',
  'evil#abc',
  '#abcde',
  'ff0000',
  'redd',
  'constructor',
  'toString',
  'rgb(11,22)',
  'rgb(1 2)',
  'rgb(1, 2 3)',
  'rgb(1 2 3 4)',
  'rgb(1..2, 3, 4)',
  'hsl(11,22,33)',
  'rgb(1 2 3 / 50%',
  'rgb(1 2 3))',
  'rgb((1 2 3)',
  'rgb(1,\n2,3)',
  'rgb(1\t2\t3)',
  'red\n',
  'red;position:fixed',
  'red; position: fixed',
  '#abc;background:url(x)',
  'rgb(11,22,33);background:url(x)',
  'url(https://evil.test/x)',
  'expression(alert(1))',
  '"><script>x()</script>',
  "red'",
  'red}',
  '{red',
  'red/**/',
  '/*x*/red',
  'r\\65 d',
  'var(--x);color:red',
  'var(--x, red)',
  'var(--x,red)',
  'var(-x)',
  'var(--)',
  'var(--a b)',
  'var( --x )',
  'var(--x))',
  'var(--x:y)',
  'var(--x/*y*/)',
  'calc(1px)',
  'color-mix(in srgb, red, blue)',
  'inherit',
  'initial',
];

describe('isSafeCssColor', () => {
  it.each(VALID)('accepts %s', (value) => {
    expect(isSafeCssColor(value)).toBe(true);
  });

  it.each(INVALID)('rejects %j', (value) => {
    expect(isSafeCssColor(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 0, {}, ['red']]) {
      expect(isSafeCssColor(value)).toBe(false);
    }
  });

  it('rejects overlong values', () => {
    expect(isSafeCssColor('var(--acme-design-table-cell-highlight-background-subtle-hover)')).toBe(true);
    expect(isSafeCssColor(`rgb(${'1'.repeat(300)} 2 3)`)).toBe(false);
  });

  it('accepts every CSS named colour and lists exactly 148', () => {
    expect(CSS_NAMED_COLORS.size).toBe(148);

    for (const name of CSS_NAMED_COLORS) {
      expect(isSafeCssColor(name)).toBe(true);
    }
  });

  it('accepts every editor preset token', () => {
    for (const name of ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red']) {
      expect(isSafeCssColor(`var(--blok-color-${name}-bg)`)).toBe(true);
      expect(isSafeCssColor(`var(--blok-color-${name}-text)`)).toBe(true);
    }
  });
});
