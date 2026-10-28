// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/* eslint-disable no-restricted-syntax, max-depth -- vendored upstream code: restyling it risks behaviour the parity suite cannot see */
import { parseOoxmlBool } from '../../parser/booleans';
import { SafeXmlNode } from '../../parser/XmlParser';

export const DRAWINGML_MATH_NAMESPACE = 'http://schemas.microsoft.com/office/drawing/2010/main';

const OMML_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/math',
  'http://purl.oclc.org/ooxml/officeDocument/math',
]);

const DRAWINGML_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
]);

export interface MathRowNode {
  kind: 'row';
  children: MathNode[];
}

export type MathNode =
  | MathRowNode
  | { kind: 'text'; text: string; normal?: boolean }
  | {
      kind: 'fraction';
      numerator: MathRowNode;
      denominator: MathRowNode;
      style: 'bar' | 'noBar' | 'skw' | 'lin';
    }
  | { kind: 'radical'; radicand: MathRowNode; degree?: MathRowNode }
  | {
      kind: 'scripts';
      base: MathRowNode;
      subscript?: MathRowNode;
      superscript?: MathRowNode;
    }
  | {
      kind: 'delimiter';
      begin: string;
      end: string;
      separator: string;
      elements: MathRowNode[];
    }
  | {
      kind: 'nary';
      operator: string;
      lower?: MathRowNode;
      upper?: MathRowNode;
      body?: MathRowNode;
      limitLocation: 'subSup' | 'undOvr';
    }
  | { kind: 'matrix'; rows: MathRowNode[][] }
  | { kind: 'function'; name: MathRowNode; argument: MathRowNode };

export interface MathFormula {
  display: 'inline' | 'block';
  body: MathRowNode;
}

function isOmml(node: SafeXmlNode, localName?: string): boolean {
  return (
    node.exists() &&
    OMML_NAMESPACES.has(node.element?.namespaceURI ?? '') &&
    (localName === undefined || node.localName === localName)
  );
}

function ommlChild(node: SafeXmlNode, localName: string): SafeXmlNode | undefined {
  return node.allChildren().find((child) => isOmml(child, localName));
}

function hasOnlyOmmlChildren(node: SafeXmlNode, allowed: ReadonlySet<string>): boolean {
  return node.allChildren().every((child) => {
    const namespace = child.element?.namespaceURI ?? '';
    return OMML_NAMESPACES.has(namespace) && allowed.has(child.localName);
  });
}

function parseRowContainer(
  node: SafeXmlNode,
  ignoredProperties: ReadonlySet<string> = new Set(['argPr', 'ctrlPr']),
): MathRowNode | undefined {
  const children: MathNode[] = [];
  for (const child of node.allChildren()) {
    if (!isOmml(child)) return undefined;
    if (ignoredProperties.has(child.localName)) continue;
    const parsed = parseSemanticNode(child);
    if (!parsed) return undefined;
    children.push(parsed);
  }
  return { kind: 'row', children };
}

function parseRequiredArgument(node: SafeXmlNode, localName: string): MathRowNode | undefined {
  const argument = ommlChild(node, localName);
  return argument ? parseRowContainer(argument) : undefined;
}

function parseOptionalArgument(
  node: SafeXmlNode,
  localName: string,
): { present: false } | { present: true; value?: MathRowNode } {
  const argument = ommlChild(node, localName);
  if (!argument) return { present: false };
  return { present: true, value: parseRowContainer(argument) };
}

function parseMathRun(node: SafeXmlNode): MathNode | undefined {
  const allowed = new Set(['rPr', 't']);
  for (const child of node.allChildren()) {
    const namespace = child.element?.namespaceURI ?? '';
    if (isOmml(child) && allowed.has(child.localName)) continue;
    if (DRAWINGML_NAMESPACES.has(namespace) && child.localName === 'rPr') continue;
    return undefined;
  }
  const textNodes = node.allChildren().filter((child) => isOmml(child, 't'));
  if (textNodes.length === 0) return undefined;
  const normalNode = ommlChild(node, 'rPr')?.child('nor');
  const normal = normalNode?.exists() ? parseOoxmlBool(normalNode.attr('val') ?? '1') : undefined;
  return {
    kind: 'text',
    text: textNodes.map((child) => child.text()).join(''),
    ...(normal !== undefined ? { normal } : {}),
  };
}

function parseFraction(node: SafeXmlNode): MathNode | undefined {
  if (!hasOnlyOmmlChildren(node, new Set(['fPr', 'num', 'den']))) return undefined;
  const numerator = parseRequiredArgument(node, 'num');
  const denominator = parseRequiredArgument(node, 'den');
  if (!numerator || !denominator) return undefined;

  const rawStyle = ommlChild(node, 'fPr')?.child('type').attr('val') ?? 'bar';
  if (!['bar', 'noBar', 'skw', 'lin'].includes(rawStyle)) return undefined;
  return {
    kind: 'fraction',
    numerator,
    denominator,
    style: rawStyle as 'bar' | 'noBar' | 'skw' | 'lin',
  };
}

function parseRadical(node: SafeXmlNode): MathNode | undefined {
  if (!hasOnlyOmmlChildren(node, new Set(['radPr', 'deg', 'e']))) return undefined;
  const radicand = parseRequiredArgument(node, 'e');
  if (!radicand) return undefined;

  const degreeArgument = parseOptionalArgument(node, 'deg');
  if (degreeArgument.present && !degreeArgument.value) return undefined;
  const degreeCandidate = degreeArgument.present ? degreeArgument.value : undefined;
  const degHideNode = ommlChild(node, 'radPr')?.child('degHide');
  const degreeHidden = degHideNode?.exists()
    ? parseOoxmlBool(degHideNode.attr('val') ?? '1')
    : false;
  const degree =
    !degreeHidden && degreeCandidate && degreeCandidate.children.length > 0
      ? degreeCandidate
      : undefined;
  return { kind: 'radical', radicand, degree };
}

function parseScripts(
  node: SafeXmlNode,
  variant: 'sSub' | 'sSup' | 'sSubSup',
): MathNode | undefined {
  const allowed = new Set([`${variant}Pr`, 'e']);
  if (variant !== 'sSup') allowed.add('sub');
  if (variant !== 'sSub') allowed.add('sup');
  if (!hasOnlyOmmlChildren(node, allowed)) return undefined;

  const base = parseRequiredArgument(node, 'e');
  if (!base) return undefined;
  const subscript = variant === 'sSup' ? undefined : parseRequiredArgument(node, 'sub');
  const superscript = variant === 'sSub' ? undefined : parseRequiredArgument(node, 'sup');
  if (variant !== 'sSup' && !subscript) return undefined;
  if (variant !== 'sSub' && !superscript) return undefined;
  return { kind: 'scripts', base, subscript, superscript };
}

function parseDelimiter(node: SafeXmlNode): MathNode | undefined {
  if (!hasOnlyOmmlChildren(node, new Set(['dPr', 'e']))) return undefined;
  const elements = node
    .allChildren()
    .filter((child) => isOmml(child, 'e'))
    .map((child) => parseRowContainer(child));
  if (elements.length === 0 || elements.some((element) => !element)) return undefined;

  const properties = ommlChild(node, 'dPr');
  return {
    kind: 'delimiter',
    begin: properties?.child('begChr').attr('val') ?? '(',
    end: properties?.child('endChr').attr('val') ?? ')',
    separator: properties?.child('sepChr').attr('val') ?? '|',
    elements: elements as MathRowNode[],
  };
}

function parseNary(node: SafeXmlNode): MathNode | undefined {
  if (!hasOnlyOmmlChildren(node, new Set(['naryPr', 'sub', 'sup', 'e']))) return undefined;
  const properties = ommlChild(node, 'naryPr');
  const lower = parseOptionalArgument(node, 'sub');
  const upper = parseOptionalArgument(node, 'sup');
  const body = parseOptionalArgument(node, 'e');
  if (
    (lower.present && !lower.value) ||
    (upper.present && !upper.value) ||
    (body.present && !body.value)
  ) {
    return undefined;
  }

  const rawLimitLocation = properties?.child('limLoc').attr('val') ?? 'subSup';
  if (rawLimitLocation !== 'subSup' && rawLimitLocation !== 'undOvr') return undefined;
  return {
    kind: 'nary',
    operator: properties?.child('chr').attr('val') ?? '∫',
    lower: lower.present ? lower.value : undefined,
    upper: upper.present ? upper.value : undefined,
    body: body.present ? body.value : undefined,
    limitLocation: rawLimitLocation,
  };
}

function parseMatrix(node: SafeXmlNode): MathNode | undefined {
  if (!hasOnlyOmmlChildren(node, new Set(['mPr', 'mr']))) return undefined;
  const rows: MathRowNode[][] = [];
  for (const rowNode of node.allChildren().filter((child) => isOmml(child, 'mr'))) {
    if (!hasOnlyOmmlChildren(rowNode, new Set(['e']))) return undefined;
    const row = rowNode
      .allChildren()
      .filter((child) => isOmml(child, 'e'))
      .map((child) => parseRowContainer(child));
    if (row.length === 0 || row.some((cell) => !cell)) return undefined;
    rows.push(row as MathRowNode[]);
  }
  return rows.length > 0 ? { kind: 'matrix', rows } : undefined;
}

function parseFunction(node: SafeXmlNode): MathNode | undefined {
  if (!hasOnlyOmmlChildren(node, new Set(['funcPr', 'fName', 'e']))) return undefined;
  const name = parseRequiredArgument(node, 'fName');
  const argument = parseRequiredArgument(node, 'e');
  return name && argument ? { kind: 'function', name, argument } : undefined;
}

function parseSemanticNode(node: SafeXmlNode): MathNode | undefined {
  if (!isOmml(node)) return undefined;
  switch (node.localName) {
    case 'r':
      return parseMathRun(node);
    case 'f':
      return parseFraction(node);
    case 'rad':
      return parseRadical(node);
    case 'sSub':
    case 'sSup':
    case 'sSubSup':
      return parseScripts(node, node.localName);
    case 'd':
      return parseDelimiter(node);
    case 'nary':
      return parseNary(node);
    case 'm':
      return parseMatrix(node);
    case 'func':
      return parseFunction(node);
    default:
      return undefined;
  }
}

function parseMathRoot(node: SafeXmlNode): MathRowNode | undefined {
  if (!isOmml(node, 'oMath')) return undefined;
  return parseRowContainer(node, new Set(['argPr', 'ctrlPr']));
}

/** Parse a DrawingML 2010 `a14:m` wrapper into the supported JSON-safe math AST. */
export function parseDrawingmlMath(wrapper: SafeXmlNode): MathFormula | undefined {
  if (wrapper.localName !== 'm' || wrapper.element?.namespaceURI !== DRAWINGML_MATH_NAMESPACE) {
    return undefined;
  }

  const children: MathNode[] = [];
  let display: MathFormula['display'] = 'inline';
  for (const root of wrapper.allChildren()) {
    if (isOmml(root, 'oMath')) {
      const row = parseMathRoot(root);
      if (!row) return undefined;
      children.push(...row.children);
      continue;
    }
    if (isOmml(root, 'oMathPara')) {
      display = 'block';
      if (!hasOnlyOmmlChildren(root, new Set(['oMathParaPr', 'oMath']))) return undefined;
      const equations = root.allChildren().filter((child) => isOmml(child, 'oMath'));
      if (equations.length === 0) return undefined;
      for (const equation of equations) {
        const row = parseMathRoot(equation);
        if (!row) return undefined;
        children.push(...row.children);
      }
      continue;
    }
    return undefined;
  }

  return children.length > 0 ? { display, body: { kind: 'row', children } } : undefined;
}

/**
 * Return true only when every DrawingML 2010 extension in a Choice is a fully
 * supported math wrapper. This keeps unknown a14 content on its authored fallback.
 */
export function isSupportedDrawingmlMathChoice(choice: SafeXmlNode): boolean {
  const root = choice.element;
  if (!root) return false;
  const stack = Array.from(root.children);
  let mathCount = 0;
  while (stack.length > 0) {
    const element = stack.pop()!;
    if (element.namespaceURI === DRAWINGML_MATH_NAMESPACE) {
      if (element.localName !== 'm') return false;
      mathCount += 1;
      if (!parseDrawingmlMath(new SafeXmlNode(element))) return false;
    }
    stack.push(...Array.from(element.children));
  }
  return mathCount > 0;
}

/** First DrawingML run properties embedded in an OMML formula, for text-style inheritance. */
export function firstMathRunProperties(wrapper: SafeXmlNode): SafeXmlNode | undefined {
  const root = wrapper.element;
  if (!root) return undefined;
  const stack = Array.from(root.children);
  while (stack.length > 0) {
    const element = stack.shift()!;
    if (DRAWINGML_NAMESPACES.has(element.namespaceURI ?? '') && element.localName === 'rPr') {
      return new SafeXmlNode(element);
    }
    stack.unshift(...Array.from(element.children));
  }
  return undefined;
}

function mathNodeText(node: MathNode): string {
  switch (node.kind) {
    case 'row':
      return node.children.map(mathNodeText).join('');
    case 'text':
      return node.text;
    case 'fraction':
      return `(${mathNodeText(node.numerator)})/(${mathNodeText(node.denominator)})`;
    case 'radical':
      return node.degree
        ? `root(${mathNodeText(node.degree)},${mathNodeText(node.radicand)})`
        : `sqrt(${mathNodeText(node.radicand)})`;
    case 'scripts':
      return `${mathNodeText(node.base)}${node.subscript ? `_(${mathNodeText(node.subscript)})` : ''}${node.superscript ? `^(${mathNodeText(node.superscript)})` : ''}`;
    case 'delimiter':
      return `${node.begin}${node.elements.map(mathNodeText).join(node.separator)}${node.end}`;
    case 'nary':
      return `${node.operator}${node.lower ? `_(${mathNodeText(node.lower)})` : ''}${node.upper ? `^(${mathNodeText(node.upper)})` : ''}${node.body ? mathNodeText(node.body) : ''}`;
    case 'matrix':
      return `[${node.rows.map((row) => row.map(mathNodeText).join(',')).join(';')}]`;
    case 'function':
      return `${mathNodeText(node.name)}(${mathNodeText(node.argument)})`;
  }
}

export function mathFormulaText(formula: MathFormula): string {
  return mathNodeText(formula.body);
}
