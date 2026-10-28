import { MAX_DEPTH } from './context';
import { attr, kid, kids } from './xml';

/**
 * Office Math (OMML) as plain text with sub/superscripts. Not real typesetting:
 * the aim is that no symbol, bracket or row of an equation goes missing.
 */

/** `m:val` of a property child, e.g. the `m:chr` of `m:naryPr`. */
const prop = (el: Element, pr: string, name: string): string | null => attr(kid(kid(el, pr), name), 'val');

type Handler = (el: Element, target: HTMLElement, depth: number) => void;

function wrapped(tag: string, el: Element | null, target: HTMLElement, depth: number): HTMLElement {
  const wrap = document.createElement(tag);
  if (el !== null) {
    renderMath(el, wrap, depth + 1);
  }
  target.appendChild(wrap);

  return wrap;
}

/** Render `children` separated by `between` (text, or a line break when null). */
function joined(children: Element[], target: HTMLElement, depth: number, between: string | null): void {
  children.forEach((child, i) => {
    if (i > 0) {
      target.append(between ?? document.createElement('br'));
    }
    renderMath(child, target, depth + 1);
  });
}

const HANDLERS: Record<string, Handler> = {
  t: (el, target) => target.append(el.textContent ?? ''),
  sup: (el, target, depth) => wrapped('sup', el, target, depth),
  sub: (el, target, depth) => wrapped('sub', el, target, depth),
  lim: (el, target, depth) => wrapped(el.parentElement?.localName === 'limUpp' ? 'sup' : 'sub', el, target, depth),
  den: (el, target, depth) => {
    target.append('/');
    renderMath(el, target, depth + 1);
  },
  nary: (el, target, depth) => {
    target.append(prop(el, 'naryPr', 'chr') ?? '∫');
    renderMath(el, target, depth + 1);
  },
  d: (el, target, depth) => {
    target.append(prop(el, 'dPr', 'begChr') ?? '(');
    joined(kids(el, 'e'), target, depth, prop(el, 'dPr', 'sepChr') ?? '|');
    target.append(prop(el, 'dPr', 'endChr') ?? ')');
  },
  rad: (el, target, depth) => {
    const degree = kid(el, 'deg');
    if (prop(el, 'radPr', 'degHide') !== '1' && (degree?.textContent ?? '') !== '') {
      wrapped('sup', degree, target, depth);
    }
    target.append('√');
    renderMath(kid(el, 'e') ?? el, target, depth + 1);
  },
  bar: (el, target, depth) => {
    wrapped('span', kid(el, 'e'), target, depth).style.textDecorationLine = 'overline';
  },
  accent: (el, target, depth) => {
    renderMath(kid(el, 'e') ?? el, target, depth + 1);
    target.append(prop(el, 'accPr', 'chr') ?? '̂');
  },
  eqArr: (el, target, depth) => joined(kids(el, 'e'), target, depth, null),
  m: (el, target, depth) => kids(el, 'mr').forEach((row, i) => {
    if (i > 0) {
      target.appendChild(document.createElement('br'));
    }
    joined(kids(row, 'e'), target, depth + 1, ' ');
  }),
};

/** Render the math children of `el` into `target`. */
export function renderMath(el: Element, target: HTMLElement, depth = 0): void {
  if (depth > MAX_DEPTH) {
    return;
  }
  // Property elements (rPr, naryPr, oMathParaPr…) carry no text; the handlers read them.
  for (const child of kids(el).filter((k) => !k.localName.endsWith('Pr'))) {
    const handler = Object.hasOwn(HANDLERS, child.localName) ? HANDLERS[child.localName] : null;
    if (handler === null) {
      renderMath(child, target, depth + 1);
    } else {
      handler(child, target, depth);
    }
  }
}
