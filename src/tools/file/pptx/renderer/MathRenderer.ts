// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/* eslint-disable no-restricted-syntax, max-depth -- vendored upstream code: restyling it risks behaviour the parity suite cannot see */
import type { MathFormula, MathNode } from '../model/nodes/MathNode';
import { mathFormulaText } from '../model/nodes/MathNode';

const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

function mathElement(localName: string, text?: string): Element {
  const element = document.createElementNS(MATHML_NAMESPACE, localName);
  if (text !== undefined) element.textContent = text;
  return element;
}

function append(parent: Element, ...children: Array<Element | undefined>): Element {
  for (const child of children) {
    if (child) parent.appendChild(child);
  }
  return parent;
}

function renderText(value: string, normal = false): Element {
  const row = mathElement('mrow');
  const tokens = value.match(/\s+|\p{L}[\p{L}\p{Mn}\p{Mc}]*|\p{N}+(?:[.,]\p{N}+)*|./gu) ?? [];
  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      row.appendChild(mathElement('mtext', token));
    } else if (/^\p{N}/u.test(token)) {
      row.appendChild(mathElement('mn', token));
    } else if (/^\p{L}/u.test(token)) {
      if (normal) {
        const identifier = mathElement('mi', token);
        identifier.setAttribute('mathvariant', 'normal');
        row.appendChild(identifier);
      } else {
        for (const character of token) row.appendChild(mathElement('mi', character));
      }
    } else {
      row.appendChild(mathElement('mo', token));
    }
  }
  const only = row.childElementCount === 1 ? row.firstElementChild : null;
  return only ?? row;
}

function renderScripts(node: Extract<MathNode, { kind: 'scripts' }>): Element {
  if (node.subscript && node.superscript) {
    return append(
      mathElement('msubsup'),
      renderMathNode(node.base),
      renderMathNode(node.subscript),
      renderMathNode(node.superscript),
    );
  }
  if (node.subscript) {
    return append(mathElement('msub'), renderMathNode(node.base), renderMathNode(node.subscript));
  }
  if (node.superscript) {
    return append(mathElement('msup'), renderMathNode(node.base), renderMathNode(node.superscript));
  }
  return renderMathNode(node.base);
}

function renderNary(node: Extract<MathNode, { kind: 'nary' }>): Element {
  const operator = mathElement('mo', node.operator);
  operator.setAttribute('largeop', 'true');
  operator.setAttribute('movablelimits', 'true');
  let decorated: Element = operator;
  if (node.lower && node.upper) {
    decorated = append(
      mathElement(node.limitLocation === 'undOvr' ? 'munderover' : 'msubsup'),
      operator,
      renderMathNode(node.lower),
      renderMathNode(node.upper),
    );
  } else if (node.lower) {
    decorated = append(
      mathElement(node.limitLocation === 'undOvr' ? 'munder' : 'msub'),
      operator,
      renderMathNode(node.lower),
    );
  } else if (node.upper) {
    decorated = append(
      mathElement(node.limitLocation === 'undOvr' ? 'mover' : 'msup'),
      operator,
      renderMathNode(node.upper),
    );
  }
  return append(mathElement('mrow'), decorated, node.body ? renderMathNode(node.body) : undefined);
}

function renderMathNode(node: MathNode): Element {
  switch (node.kind) {
    case 'row':
      return append(mathElement('mrow'), ...node.children.map(renderMathNode));
    case 'text':
      return renderText(node.text, node.normal);
    case 'fraction': {
      if (node.style === 'lin') {
        return append(
          mathElement('mrow'),
          renderMathNode(node.numerator),
          mathElement('mo', '/'),
          renderMathNode(node.denominator),
        );
      }
      const fraction = append(
        mathElement('mfrac'),
        renderMathNode(node.numerator),
        renderMathNode(node.denominator),
      );
      if (node.style === 'noBar') fraction.setAttribute('linethickness', '0');
      if (node.style === 'skw') fraction.setAttribute('bevelled', 'true');
      return fraction;
    }
    case 'radical':
      return node.degree
        ? append(mathElement('mroot'), renderMathNode(node.radicand), renderMathNode(node.degree))
        : append(mathElement('msqrt'), renderMathNode(node.radicand));
    case 'scripts':
      return renderScripts(node);
    case 'delimiter': {
      const row = mathElement('mrow');
      const opening = mathElement('mo', node.begin);
      opening.setAttribute('fence', 'true');
      opening.setAttribute('stretchy', 'true');
      row.appendChild(opening);
      node.elements.forEach((element, index) => {
        if (index > 0) {
          const separator = mathElement('mo', node.separator);
          separator.setAttribute('separator', 'true');
          row.appendChild(separator);
        }
        row.appendChild(renderMathNode(element));
      });
      const closing = mathElement('mo', node.end);
      closing.setAttribute('fence', 'true');
      closing.setAttribute('stretchy', 'true');
      row.appendChild(closing);
      return row;
    }
    case 'nary':
      return renderNary(node);
    case 'matrix': {
      const table = mathElement('mtable');
      table.setAttribute('columnspacing', '1.1em');
      table.setAttribute('rowspacing', '0.5em');
      for (const row of node.rows) {
        const tableRow = mathElement('mtr');
        for (const cell of row) {
          const tableCell = mathElement('mtd');
          // Chromium exposes MathML matrices through table layout but currently
          // ignores mtable row/column spacing attributes. Cell padding keeps the
          // authored matrix topology readable while preserving native MathML.
          tableCell.setAttribute('style', 'padding: 0.25em 0.55em');
          tableRow.appendChild(append(tableCell, renderMathNode(cell)));
        }
        table.appendChild(tableRow);
      }
      return table;
    }
    case 'function': {
      return append(
        mathElement('mrow'),
        renderMathNode(node.name),
        mathElement('mo', '\u2061'),
        renderMathNode(node.argument),
      );
    }
  }
}

/** Render the bounded OMML model as browser-native Presentation MathML. */
export function renderMathFormula(formula: MathFormula): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.style.display = 'inline-block';
  wrapper.style.verticalAlign = 'middle';
  wrapper.style.whiteSpace = 'nowrap';
  wrapper.style.lineHeight = 'normal';

  const math = mathElement('math');
  math.setAttribute('display', formula.display);
  math.setAttribute('aria-label', mathFormulaText(formula));
  math.setAttribute('style', 'font-family: inherit; font-size: inherit');
  math.appendChild(renderMathNode(formula.body));
  wrapper.appendChild(math);
  return wrapper;
}
