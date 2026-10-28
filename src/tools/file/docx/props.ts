import { attr, hexColor, kid, num, onOff, round, twips, val } from './xml';

/**
 * CSS declarations keyed by property. Keys starting with `@` are not CSS: they
 * hold run facts that only combine into CSS at apply time (underline and strike
 * share `text-decoration-line`; superscript shrinks whatever size wins).
 */
export type Css = Record<string, string>;

export interface ParaProps {
  css: Css;
  styleId?: string;
  numId?: string;
  ilvl?: number;
  pageBreakBefore?: boolean;
  bidi?: boolean;
}

export interface ThemeFonts {
  major: string | null;
  minor: string | null;
}

/** Later layers win, key by key. */
export function mergeCss(...layers: Array<Css | undefined>): Css {
  return layers.reduce<Css>((acc, layer) => (layer === undefined ? acc : { ...acc, ...layer }), {});
}

/** A fresh CSS map and a setter that writes a key only when the value is present. */
function cssBuilder(): { css: Css; set: (key: string, value: string | null | undefined) => void } {
  const css: Css = {};
  const set = (key: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined) {
      css[key] = value;
    }
  };

  return { css, set };
}

/** Later layers win, field by field; `css` merges key by key. */
export function mergePara(...layers: Array<ParaProps | undefined>): ParaProps {
  return layers.reduce<ParaProps>((acc, layer) => {
    if (layer === undefined) {
      return acc;
    }

    return {
      ...acc,
      ...Object.fromEntries(Object.entries(layer).filter(([, value]) => value !== undefined)),
      css: mergeCss(acc.css, layer.css),
    };
  }, { css: {} });
}

const UNDERLINE: Record<string, string> = {
  single: 'solid', words: 'solid', thick: 'solid', double: 'double',
  dotted: 'dotted', dottedHeavy: 'dotted', dash: 'dashed', dashedHeavy: 'dashed',
  dashLong: 'dashed', dashLongHeavy: 'dashed', dotDash: 'dashed', dashDotHeavy: 'dashed',
  dotDotDash: 'dashed', dashDotDotHeavy: 'dashed', wave: 'wavy', wavyHeavy: 'wavy',
  wavyDouble: 'wavy', none: 'none',
};

const HIGHLIGHT: Record<string, string> = {
  black: '#000000', blue: '#0000ff', cyan: '#00ffff', green: '#00ff00', magenta: '#ff00ff',
  red: '#ff0000', yellow: '#ffff00', white: '#ffffff', darkBlue: '#000080', darkCyan: '#008080',
  darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000',
  darkGray: '#808080', lightGray: '#c0c0c0',
};

const SERIF = /times|cambria|georgia|garamond|serif|roman|palatino|baskerville|minion|book antiqua|constantia/i;
const MONO = /courier|mono|consolas|menlo|code/i;

/**
 * A font name as a `font-family` value with a generic fallback. The name is
 * stripped to plain characters, so it cannot end the CSS string it sits in.
 */
export function fontFamily(name: string): string | null {
  const clean = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim();
  if (clean === '') {
    return null;
  }

  return `"${clean}", ${genericFamily(clean)}`;
}

function genericFamily(name: string): string {
  if (MONO.test(name)) {
    return 'monospace';
  }

  return SERIF.test(name) ? 'serif' : 'sans-serif';
}

/** The `w:fill` of a `w:shd` as a background colour. */
export function shading(el: Element | null): string | null {
  return el === null ? null : hexColor(attr(el, 'fill'));
}

function themeFont(themeRef: string, theme: ThemeFonts): string | null {
  return themeRef.startsWith('major') ? theme.major : theme.minor;
}

function vertAlign(value: string): string | null {
  switch (value) {
    case 'superscript':
      return 'super';
    case 'subscript':
      return 'sub';
    case 'baseline':
      return 'baseline';
    default:
      return null;
  }
}

function runFont(rFonts: Element | null, theme: ThemeFonts): string | null {
  if (rFonts === null) {
    return null;
  }
  const themeRef = attr(rFonts, 'asciiTheme') ?? attr(rFonts, 'hAnsiTheme');
  const themed = themeRef === null ? null : themeFont(themeRef, theme);
  // Only the Latin slots: an East Asian or complex-script font must not take over Latin text.
  const name = attr(rFonts, 'ascii') ?? attr(rFonts, 'hAnsi') ?? themed;

  return name === null ? null : fontFamily(name);
}

/** Read a `w:rPr` into run CSS. */
export function parseRunProps(rPr: Element | null, theme: ThemeFonts): Css {
  const { css, set } = cssBuilder();
  if (rPr === null) {
    return css;
  }
  const toggle = (name: string, key: string, on: string, off: string): void => {
    const value = onOff(rPr, name);
    if (value !== null) {
      css[key] = value ? on : off;
    }
  };

  toggle('b', 'font-weight', 'bold', 'normal');
  toggle('i', 'font-style', 'italic', 'normal');
  toggle('caps', 'text-transform', 'uppercase', 'none');
  toggle('smallCaps', 'font-variant', 'small-caps', 'normal');
  toggle('vanish', '@hidden', '1', '0');
  toggle('strike', '@strike', 'solid', 'none');
  toggle('dstrike', '@strike', 'double', 'none');

  const u = kid(rPr, 'u');
  if (u !== null) {
    set('@u', UNDERLINE[attr(u, 'val') ?? 'single'] ?? 'solid');
    set('@u-color', hexColor(attr(u, 'color')));
  }
  set('color', hexColor(val(rPr, 'color')));
  const sz = num(val(rPr, 'sz'));
  set('font-size', sz === null ? null : `${round(sz / 2)}pt`);
  set('@vert', vertAlign(val(rPr, 'vertAlign') ?? ''));
  // w:position raises or lowers the text, in half-points.
  const position = num(val(rPr, 'position'));
  set('vertical-align', position === null || position === 0 ? null : `${round(position / 2)}pt`);
  set('background-color', HIGHLIGHT[val(rPr, 'highlight') ?? ''] ?? shading(kid(rPr, 'shd')));
  set('font-family', runFont(kid(rPr, 'rFonts'), theme));

  return css;
}

/** Turn merged run CSS into the declarations an element receives. */
export function runDeclarations(css: Css): Css {
  const out: Css = {};
  for (const [key, value] of Object.entries(css)) {
    if (!key.startsWith('@')) {
      out[key] = value;
    }
  }
  const lines = [
    css['@u'] !== undefined && css['@u'] !== 'none' ? 'underline' : null,
    css['@strike'] !== undefined && css['@strike'] !== 'none' ? 'line-through' : null,
  ].filter((line): line is string => line !== null);
  if (lines.length > 0) {
    out['text-decoration-line'] = lines.join(' ');
    const style = css['@strike'] === 'double' && !lines.includes('underline') ? 'double' : css['@u'];
    if (style !== undefined && style !== 'solid' && style !== 'none') {
      out['text-decoration-style'] = style;
    }
    if (css['@u-color'] !== undefined) {
      out['text-decoration-color'] = css['@u-color'];
    }
  }
  const vert = css['@vert'];
  if (vert === 'super' || vert === 'sub') {
    out['vertical-align'] = vert;
    const size = /^([\d.]+)pt$/.exec(out['font-size'] ?? '');
    out['font-size'] = size === null ? '0.65em' : `${round(Number(size[1]) * 0.65)}pt`;
  }

  return out;
}

const BORDER_STYLE: Record<string, string> = { single: 'solid', thick: 'solid', double: 'double', dotted: 'dotted', dashed: 'dashed' };

/** A Word border element (`w:top`, `w:bottom`…) as a CSS `border` value. */
export function borderCss(el: Element): string {
  const value = attr(el, 'val');
  if (value === null || value === 'none' || value === 'nil') {
    return 'none';
  }
  const dashed = value.startsWith('dash') ? 'dashed' : 'solid';
  const style = Object.hasOwn(BORDER_STYLE, value) ? BORDER_STYLE[value] : dashed;
  // w:sz is in eighths of a point.
  const width = Math.min(6, Math.max(0.25, (num(attr(el, 'sz')) ?? 4) / 8));
  const color = hexColor(attr(el, 'color')) ?? 'currentColor';

  return `${round(width)}pt ${style} ${color}`;
}

const JUSTIFY: Record<string, string> = {
  left: 'start', start: 'start', center: 'center', right: 'end', end: 'end',
  both: 'justify', distribute: 'justify', thaiDistribute: 'justify',
};

/** Word's line height for auto-spaced paragraphs whose spacing says `autospacing`. */
const AUTOSPACING = '14pt';

/** CSS sides of a paragraph border, with the Word element names that set each. */
const PARAGRAPH_SIDES: Array<[string, string[]]> = [
  ['top', ['top']], ['bottom', ['bottom']], ['inline-start', ['start', 'left']], ['inline-end', ['end', 'right']],
];

/** `w:pBdr` edges; `w:space` is the gap to the text, in points. */
function paragraphBorders(pBdr: Element | null, set: (key: string, value: string | null | undefined) => void): void {
  for (const [side, names] of PARAGRAPH_SIDES) {
    const el = names.map((name) => kid(pBdr, name)).find((found) => found !== null) ?? null;
    if (el !== null) {
      set(`border-${side}`, borderCss(el));
      const space = num(attr(el, 'space'));
      set(`padding-${side}`, space === null ? null : `${round(space)}pt`);
    }
  }
}

/** Read a `w:pPr` into paragraph properties. */
export function parseParaProps(pPr: Element | null): ParaProps {
  const { css, set } = cssBuilder();
  const props: ParaProps = { css };
  if (pPr === null) {
    return props;
  }

  const jc = val(pPr, 'jc');
  set('text-align', jc === null ? null : JUSTIFY[jc]);

  const ind = kid(pPr, 'ind');
  if (ind !== null) {
    set('margin-inline-start', twips(attr(ind, 'start') ?? attr(ind, 'left')));
    set('margin-inline-end', twips(attr(ind, 'end') ?? attr(ind, 'right')));
    const hanging = num(attr(ind, 'hanging'));
    set('text-indent', hanging === null ? twips(attr(ind, 'firstLine')) : `${round(-hanging / 20)}pt`);
  }

  const spacing = kid(pPr, 'spacing');
  if (spacing !== null) {
    set('margin-top', attr(spacing, 'beforeAutospacing') === '1' ? AUTOSPACING : twips(attr(spacing, 'before')));
    set('margin-bottom', attr(spacing, 'afterAutospacing') === '1' ? AUTOSPACING : twips(attr(spacing, 'after')));
    const line = num(attr(spacing, 'line'));
    const rule = attr(spacing, 'lineRule') ?? 'auto';
    if (line !== null && line > 0) {
      set('line-height', rule === 'auto' ? String(round(line / 240)) : `${round(line / 20)}pt`);
    }
  }

  set('background-color', shading(kid(pPr, 'shd')));
  paragraphBorders(kid(pPr, 'pBdr'), set);

  const styleId = val(pPr, 'pStyle');
  if (styleId !== null) {
    props.styleId = styleId;
  }
  const numPr = kid(pPr, 'numPr');
  if (numPr !== null) {
    const numId = val(numPr, 'numId');
    if (numId !== null) {
      props.numId = numId;
    }
    props.ilvl = num(val(numPr, 'ilvl')) ?? 0;
  }
  const pageBreakBefore = onOff(pPr, 'pageBreakBefore');
  if (pageBreakBefore !== null) {
    props.pageBreakBefore = pageBreakBefore;
  }
  const bidi = onOff(pPr, 'bidi');
  if (bidi !== null) {
    props.bidi = bidi;
  }

  return props;
}

/** Apply declarations through the CSSOM, which drops invalid values. */
export function applyCss(el: HTMLElement, css: Css): void {
  for (const [key, value] of Object.entries(css)) {
    el.style.setProperty(key, value);
  }
}
