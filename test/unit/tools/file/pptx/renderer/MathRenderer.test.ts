// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../helpers/domShims';
import { renderMathFormula } from '../../../../../../src/tools/file/pptx/renderer/MathRenderer';
import type { MathFormula, MathNode, MathRowNode } from '../../../../../../src/tools/file/pptx/model/nodes/MathNode';

const row = (...children: MathNode[]): MathRowNode => ({ kind: 'row', children });
const text = (value: string): MathNode => ({ kind: 'text', text: value });
const formula = (body: MathNode, display: MathFormula['display'] = 'inline'): MathFormula => ({
  display,
  body: body.kind === 'row' ? body : row(body),
});

describe('MathRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tokenizes identifiers, numbers, and operators into native MathML', () => {
    const wrapper = renderMathFormula(formula(row(text('x+12'))));
    const math = wrapper.querySelector('math')!;

    expect(math.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    expect(math.getAttribute('display')).toBe('inline');
    expect(
      [...math.querySelectorAll('mi, mn, mo')].map((node) => [node.localName, node.textContent]),
    ).toEqual([
      ['mi', 'x'],
      ['mo', '+'],
      ['mn', '12'],
    ]);
    expect(math.getAttribute('aria-label')).toBe('x+12');
  });

  it('renders fractions, radicals, and scripts with their MathML topology', () => {
    const wrapper = renderMathFormula(
      formula(
        row(
          {
            kind: 'fraction',
            style: 'bar',
            numerator: row(text('a')),
            denominator: row(text('b')),
          },
          { kind: 'radical', radicand: row(text('x')), degree: row(text('3')) },
          {
            kind: 'scripts',
            base: row(text('x')),
            subscript: row(text('i')),
            superscript: row(text('2')),
          },
        ),
      ),
    );

    const math = wrapper.querySelector('math')!;
    expect(math.querySelectorAll('mfrac')).toHaveLength(1);
    expect(math.querySelectorAll('mroot')).toHaveLength(1);
    expect(math.querySelectorAll('msubsup')).toHaveLength(1);
  });

  it('maps the remaining OMML fraction variants without flattening their structure', () => {
    const fraction = (style: 'noBar' | 'skw' | 'lin'): MathNode => ({
      kind: 'fraction',
      style,
      numerator: row(text('a')),
      denominator: row(text('b')),
    });
    const math = renderMathFormula(
      formula(row(fraction('noBar'), fraction('skw'), fraction('lin'))),
    ).querySelector('math')!;
    const fractions = math.querySelectorAll('mfrac');

    expect(fractions).toHaveLength(2);
    expect(fractions[0].getAttribute('linethickness')).toBe('0');
    expect(fractions[1].getAttribute('bevelled')).toBe('true');
    expect([...math.querySelectorAll('mo')].some((operator) => operator.textContent === '/')).toBe(
      true,
    );
  });

  it('renders delimiters, under-over n-ary operators, matrices, and functions', () => {
    const wrapper = renderMathFormula(
      formula(
        row(
          {
            kind: 'delimiter',
            begin: '(',
            end: ')',
            separator: '|',
            elements: [row(text('x')), row(text('y'))],
          },
          {
            kind: 'nary',
            operator: '∑',
            lower: row(text('i=1')),
            upper: row(text('n')),
            body: row(text('i')),
            limitLocation: 'undOvr',
          },
          {
            kind: 'matrix',
            rows: [
              [row(text('1')), row(text('2'))],
              [row(text('3')), row(text('4'))],
            ],
          },
          {
            kind: 'function',
            name: row({ kind: 'text', text: 'sin', normal: true }),
            argument: row(text('θ')),
          },
        ),
        'block',
      ),
    );

    const math = wrapper.querySelector('math')!;
    expect(math.getAttribute('display')).toBe('block');
    expect(math.querySelectorAll('munderover')).toHaveLength(1);
    expect(math.querySelectorAll('mtable > mtr')).toHaveLength(2);
    expect(math.querySelectorAll('mtd')).toHaveLength(4);
    expect(math.querySelector('mtd')?.getAttribute('style')).toBe('padding: 0.25em 0.55em');
    expect(math.querySelector('mtable')?.getAttribute('columnspacing')).toBe('1.1em');
    expect(math.querySelector('mtable')?.getAttribute('rowspacing')).toBe('0.5em');
    expect(math.querySelector('mi[mathvariant="normal"]')?.textContent).toBe('sin');
    expect(math.textContent).toContain('\u2061');
  });
});
