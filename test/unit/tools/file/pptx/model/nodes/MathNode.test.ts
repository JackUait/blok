// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../../helpers/domShims';
import {
  mathFormulaText,
  parseDrawingmlMath,
  type MathFormula,
} from '../../../../../../../src/tools/file/pptx/model/nodes/MathNode';
import { parseXml } from '../../../../../../../src/tools/file/pptx/parser/XmlParser';

const NS = [
  'xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
].join(' ');

function parse(body: string): MathFormula | undefined {
  return parseDrawingmlMath(parseXml(`<a14:m ${NS}>${body}</a14:m>`));
}

const run = (text: string): string => `<m:r><a:rPr/><m:t>${text}</m:t></m:r>`;

describe('DrawingML math parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses inline runs in source order', () => {
    const formula = parse(`<m:oMath>${run('x')}${run('+')}${run('1')}</m:oMath>`);

    expect(formula).toEqual({
      display: 'inline',
      body: {
        kind: 'row',
        children: [
          { kind: 'text', text: 'x' },
          { kind: 'text', text: '+' },
          { kind: 'text', text: '1' },
        ],
      },
    });
    expect(mathFormulaText(formula!)).toBe('x+1');
  });

  it('parses a block fraction and preserves its fraction type', () => {
    const formula = parse(
      `<m:oMathPara><m:oMath><m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>${run(
        'a+b',
      )}</m:num><m:den>${run('c+d')}</m:den></m:f></m:oMath></m:oMathPara>`,
    );

    expect(formula).toMatchObject({
      display: 'block',
      body: {
        kind: 'row',
        children: [
          {
            kind: 'fraction',
            style: 'bar',
            numerator: { kind: 'row', children: [{ kind: 'text', text: 'a+b' }] },
            denominator: { kind: 'row', children: [{ kind: 'text', text: 'c+d' }] },
          },
        ],
      },
    });
    expect(mathFormulaText(formula!)).toBe('(a+b)/(c+d)');
  });

  it.each(['noBar', 'skw', 'lin'] as const)('parses the %s fraction variant', (style) => {
    const formula = parse(
      `<m:oMath><m:f><m:fPr><m:type m:val="${style}"/></m:fPr><m:num>${run(
        'a',
      )}</m:num><m:den>${run('b')}</m:den></m:f></m:oMath>`,
    );

    expect(formula?.body.children[0]).toMatchObject({ kind: 'fraction', style });
  });

  it('parses radicals with hidden and explicit degrees', () => {
    const squareRoot = parse(
      `<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${run(
        'x',
      )}</m:e></m:rad></m:oMath>`,
    );
    const indexedRoot = parse(
      `<m:oMath><m:rad><m:radPr/><m:deg>${run('3')}</m:deg><m:e>${run(
        'x',
      )}</m:e></m:rad></m:oMath>`,
    );

    expect(squareRoot?.body.children[0]).toMatchObject({
      kind: 'radical',
      degree: undefined,
    });
    expect(indexedRoot?.body.children[0]).toMatchObject({
      kind: 'radical',
      degree: { kind: 'row', children: [{ kind: 'text', text: '3' }] },
    });
  });

  it.each([
    [
      'sSub',
      '<m:sSub><m:sSubPr/><m:e>' + run('x') + '</m:e><m:sub>' + run('i') + '</m:sub></m:sSub>',
      { subscript: { kind: 'row', children: [{ kind: 'text', text: 'i' }] } },
    ],
    [
      'sSup',
      '<m:sSup><m:sSupPr/><m:e>' + run('x') + '</m:e><m:sup>' + run('2') + '</m:sup></m:sSup>',
      { superscript: { kind: 'row', children: [{ kind: 'text', text: '2' }] } },
    ],
    [
      'sSubSup',
      '<m:sSubSup><m:sSubSupPr/><m:e>' +
        run('x') +
        '</m:e><m:sub>' +
        run('i') +
        '</m:sub><m:sup>' +
        run('2') +
        '</m:sup></m:sSubSup>',
      {
        subscript: { kind: 'row', children: [{ kind: 'text', text: 'i' }] },
        superscript: { kind: 'row', children: [{ kind: 'text', text: '2' }] },
      },
    ],
  ])('parses %s scripts', (_name, xml, expected) => {
    expect(parse(`<m:oMath>${xml}</m:oMath>`)?.body.children[0]).toMatchObject({
      kind: 'scripts',
      base: { kind: 'row', children: [{ kind: 'text', text: 'x' }] },
      ...expected,
    });
  });

  it('parses delimiters, n-ary operators, matrices, and functions', () => {
    const delimiters = parse(
      `<m:oMath><m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/><m:sepChr m:val="|"/></m:dPr><m:e>${run(
        'x',
      )}</m:e><m:e>${run('y')}</m:e></m:d></m:oMath>`,
    );
    const nary = parse(
      `<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${run(
        'i=1',
      )}</m:sub><m:sup>${run('n')}</m:sup><m:e>${run('i')}</m:e></m:nary></m:oMath>`,
    );
    const matrix = parse(
      `<m:oMath><m:m><m:mr><m:e>${run('1')}</m:e><m:e>${run(
        '2',
      )}</m:e></m:mr><m:mr><m:e>${run('3')}</m:e><m:e>${run('4')}</m:e></m:mr></m:m></m:oMath>`,
    );
    const func = parse(
      `<m:oMath><m:func><m:funcPr/><m:fName><m:r><m:rPr><m:nor m:val="1"/></m:rPr><a:rPr/><m:t>sin</m:t></m:r></m:fName><m:e>${run(
        'θ',
      )}</m:e></m:func></m:oMath>`,
    );

    expect(delimiters?.body.children[0]).toMatchObject({
      kind: 'delimiter',
      begin: '[',
      end: ']',
      separator: '|',
      elements: [{ kind: 'row' }, { kind: 'row' }],
    });
    expect(nary?.body.children[0]).toMatchObject({
      kind: 'nary',
      operator: '∑',
      limitLocation: 'undOvr',
      lower: { kind: 'row' },
      upper: { kind: 'row' },
      body: { kind: 'row' },
    });
    expect(matrix?.body.children[0]).toMatchObject({
      kind: 'matrix',
      rows: [
        [{ kind: 'row' }, { kind: 'row' }],
        [{ kind: 'row' }, { kind: 'row' }],
      ],
    });
    expect(func?.body.children[0]).toMatchObject({
      kind: 'function',
      name: { kind: 'row', children: [{ kind: 'text', text: 'sin', normal: true }] },
      argument: { kind: 'row', children: [{ kind: 'text', text: 'θ' }] },
    });
  });

  it('rejects the whole formula when it contains an unsupported semantic construct', () => {
    expect(parse(`<m:oMath>${run('x')}<m:eqArr/></m:oMath>`)).toBeUndefined();
  });
});
